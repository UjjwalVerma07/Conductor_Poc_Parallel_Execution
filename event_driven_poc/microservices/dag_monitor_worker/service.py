import os 
import json 
import tempfile
import time
import uuid
import logging
import requests
from kafka import KafkaConsumer,KafkaProducer
from s3_utils import S3Manager
from minio_utils import MinIOManager
from config import Config
from concurrent.futures import ThreadPoolExecutor
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

logger=logging.getLogger(__name__)

s3_manager=S3Manager()
minio_manager=MinIOManager()
DAG_MONITOR_TOPIC = os.getenv("DAG_MONITOR_TOPIC", "dag-monitor-queue")
KAFKA_BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP', 'localhost:9092')
MWAA_ENDPOINT = os.getenv('MWAA_ENDPOINT')
MWAA_SESSION_TOKEN = os.getenv('MWAA_SESSION_TOKEN')
DAG_POLL_INTERVAL = int(os.getenv('DAG_POLL_INTERVAL', 10))
DAG_MAX_WAIT_TIME = int(os.getenv('DAG_MAX_WAIT_TIME', 3600))
SERVICE_NAME = os.getenv('SERVICE_NAME', 'dag-monitor-worker')

kafka_producer=KafkaProducer(
    bootstrap_servers=KAFKA_BOOTSTRAP,
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)


class DAGMonitorWorker:
    """Monitors Airflow DAG runs and publishes completion events."""

    def __init__(self):
        self.kafka_producer=kafka_producer
        self.s3_manager=s3_manager
        self.minio_manager=minio_manager
    
    def check_dag_status(self,dag_id,dag_run_id):
        """Checks the status of a specific DAG run."""

        try:
            if not MWAA_SESSION_TOKEN:
                logger.error("MWAA Session Token is missing")
                return None, "Session token not configured"
            api_url= f"{MWAA_ENDPOINT}/api/v1/dags/{dag_id}/dagRuns/{dag_run_id}"
            response=requests.get(
                api_url,
                cookies={"session": MWAA_SESSION_TOKEN},
                headers={"Content-Type": "application/json"},
                timeout=30
            )

            if response.status_code==200:
                dag_run_data=response.json()
                state=dag_run_data.get('state','unknown')
                return state,None,dag_run_data
            
            elif response.status_code==404:
                return None,f"Dag run not found: {dag_run_id}",None
            
            else:
                return None,f"API Error {response.status_code}: {response.text}",None
        
        except requests.exceptions.RequestException as e: 
            return None,f"Network Error : {str(e)}",None
        except Exception as e: 
            return None,f"Error checking DAG status: {str(e)}",None
        
    
    def wait_for_dag_completion(self,dag_id,dag_run_id,workflow_id=None,timeout=None,minio_output_bucket=None):
        """Waits for the Specific dag to complete"""
        """Poll DAG run until completes"""
        timeout=timeout or DAG_MAX_WAIT_TIME
        start_time=time.time()
        logger.info(f"Monitoring DAG '{dag_id}' run '{dag_run_id}' for completion...")
        while True:
            elapsed=time.time()-start_time
            if elapsed>timeout:
                logger.error(f"Timeout waiting for DAG '{dag_id}' run '{dag_run_id}' to complete.")
                return False,"timeout","Timeout waiting for DAG completion"
            
            state,error,response_data=self.check_dag_status(dag_id,dag_run_id)
            if error: 
                logger.error(f"Error fetching DAG status:{error}")
                return False,'error',error
            
            if state is None:
                logger.warning(f"Could not determine DAG run status")
                time.sleep(DAG_POLL_INTERVAL)
                continue
            logger.info(f"DAG Run Status:{dag_run_id} , State:{state} , Elapsed({int(elapsed)}s)")


            if state in ['success','failed','skipped','upstream_failed']:
                if state=='success' and response_data:
                    #Download Stats from S3 and upload it to MINIO
                    if response_data is not None:
                        stats_url=response_data.get('conf',{}).get('stats_url','')
                        logger.info(f"Stats Url Fetched is : {stats_url}")
                        stats_url=stats_url.replace("s3://","").split("/",1)
                        logger.info(f"Updated Stats URL: {stats_url}")
                        stats_bucket=stats_url[0]
                        stats_key=stats_url[1]
                        logger.info(f"Stats Bucket: {stats_bucket}")
                        logger.info(f"Stats Key: {stats_key}")
                        stats_input_key=stats_key.split("/")[-1]
                        logger.info(f"Input Stats Key is : {stats_input_key}")
                        input_key=f"conductor-poc/runs/{workflow_id}/{stats_input_key}"

                        with tempfile.NamedTemporaryFile(delete=False,suffix=".jsonl") as stats_file:
                            try:
                                s3_manager.download_file(input_key,stats_file.name)
                            except Exception as e:
                                logger.error(f"Error downloading stats file from S3: {e}")
                                return False,'error',f"Error downloading stats file from S3: {e}"
                            minio_manager.upload_file(stats_file.name,bucket=minio_output_bucket,object_key=stats_input_key)
                            logger.info(f"Stats File is Uploaded to MINIO")
                            logger.info(f"Stats File is now downloaded from {input_key} and saved locally: {stats_file.name}")
                    logger.info(f"DAG run completed successfully....")
                    return True,state,None
                else:
                    logger.error(f"DAG run completed with state: {state}")
                    return False,state,f"DAG run ended with state:{state}"

            if state in ['queued','running','up_for_retry','up_for_reschedule']:
                time.sleep(DAG_POLL_INTERVAL)
                continue

            logger.warning(f"Unknown DAG run state: {state},continuning to monitor...")
            time.sleep(DAG_POLL_INTERVAL)


    def publish_completion_event(self,workflow_id,task_id,dag_id,jobid,status,error_message=None,metadata_url=None,event_type=None,minio_output_bucket=None):
        """Publishes DAG completion event to Kafka"""
        try:            
            completion_event = {
                "workflowId": workflow_id,
                "taskId": task_id,
                "eventType": event_type,  
                "data": {
                    "dag_id": dag_id,
                    "jobid": jobid,
                    "status": status,
                    "result": "success" if status == "success" else "failure",
                    "pipelineStage": "airflow_processing",
                    "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ'),
                    "stats_url":f"minio://{minio_output_bucket}/NameParse_Stats.jsonl" if status=="success" else None
                }
            }

            if metadata_url:
                completion_event["data"]["metadata_url"] = metadata_url
            if status=="failed" and error_message:
                completion_event["data"]["error"] = error_message

            self.kafka_producer.send("conductor-events",completion_event)
            self.kafka_producer.flush()
            

            logger.info(f"Published DAG completion event to conductor-events for workflows {workflow_id}")
            logger.info(f"Event Type : {event_type}")
            logger.info(f"DAG:{dag_id},Job:{jobid},Status:{status}")
        except Exception as e:
            logger.error(f"Error publishing DAG completion event: {e}", exc_info=True)


    def process_event(self,event):
        workflow_id = event["workflowId"]
        task_id = event["taskId"]
        metadata_key=event.get("metadata_key")
        minio_output_bucket=event.get("minio_output_bucket")
        minio_output_key=event.get("minio_output_key")
        event_type=event.get("event_type")
        data = event["data"]
        dag_id = data["dag_id"]
        dag_run_id = data.get("dag_run_id") or str(uuid.uuid4())
        jobid = data.get("jobid") or str(uuid.uuid4())
        logger.info(f"Task Id is : {task_id}")
        success, state, error = self.wait_for_dag_completion(
            dag_id, dag_run_id, workflow_id,minio_output_bucket=minio_output_bucket
        )

        if success:
            output_uri=""
            with tempfile.NamedTemporaryFile(delete=False,suffix=".json") as temp_file:
                s3_manager.download_file(metadata_key,temp_file.name)
        
            with open(temp_file.name,'r') as f:
                metadata_data=json.load(f)
                output_uri=metadata_data.get('service',{}).get('output',{}).get('uri')
        
            if output_uri:
                output_key=output_uri.split("/",3)[-1]
                with tempfile.NamedTemporaryFile(delete=False,suffix=".out") as output_file:
                    s3_manager.download_file(output_key,output_file.name)
                    logger.info(f"OutputFile Downloaded From S3 Now Preaparing to upload on MINIO")
                    minio_manager.upload_file(output_file.name,minio_output_bucket,minio_output_key)
                    logger.info(f"Uploaded output file to MINIO")

            else:
                logger.error(f"Output URI not found in metadata")

        status = "success" if success else "failed"
        self.publish_completion_event(
            workflow_id, task_id, dag_id, jobid, status, error,event_type=event_type,minio_output_bucket=minio_output_bucket
        )

    def consume_event(self):
        """Consume DAG triggers events from Kafka"""
        consumer=KafkaConsumer(
            DAG_MONITOR_TOPIC,
            bootstrap_servers=KAFKA_BOOTSTRAP,
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            group_id=f"{SERVICE_NAME}-group",
            auto_offset_reset='latest'
        )
        max_workers=int(os.getenv('MAX_WORKERS',10))
        executor=ThreadPoolExecutor(max_workers=max_workers,
                                    thread_name_prefix='dag-monitor')
        


        logger.info(f"Consuming DAG monitor events from '{DAG_MONITOR_TOPIC}' topic...")
        logger.info(f"Kafka Topic: {DAG_MONITOR_TOPIC}")

        for message in consumer:
            try:
                event=message.value

                if isinstance(event,str):
                    try:
                        event=json.loads(event)
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse JSON string: {event}")
                
                # self.process_event(event)
                executor.submit(self.process_event,event)

            except Exception as e:
                logger.error(f"Error processing message: {e}",exc_info=True)


def main():
    """Start the Service"""
    logger.info(f"Starting DAG Monitor Worker")
    service = DAGMonitorWorker()
    service.consume_event()

if __name__ == "__main__":
    main()
