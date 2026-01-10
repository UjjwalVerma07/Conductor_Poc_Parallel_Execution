
#!/usr/bin/env python3
import os
import json
import time
import logging
import subprocess
from minio.xml import _S3_NAMESPACE
import requests
import re
from kafka import KafkaConsumer, KafkaProducer
import tempfile
from s3_utils import S3Manager
from minio_utils import MinIOManager
import uuid
from config import Config
s3_manager=S3Manager()
minio_manager=MinIOManager()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
KAFKA_BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP', 'localhost:9092')
SERVICE_NAME = os.getenv('SERVICE_NAME', 'airflow-adapter')

# MWAA Configuration
MWAA_ENDPOINT = os.getenv('MWAA_ENDPOINT', 'https://a53c6d7a-ec07-465a-9824-6cc199145a7a-vpce.c75.us-east-1.airflow.amazonaws.com:443')
MWAA_SESSION_TOKEN = os.getenv('MWAA_SESSION_TOKEN', '')

# DAG Monitoring Configuration
DAG_POLL_INTERVAL = int(os.getenv('DAG_POLL_INTERVAL', '10'))  # seconds between status checks
DAG_MAX_WAIT_TIME = int(os.getenv('DAG_MAX_WAIT_TIME', '3600'))  # max time to wait (1 hour default)

DAG_MONITOR_TOPIC = os.getenv("DAG_MONITOR_TOPIC", "dag-monitor-queue")

# Script path
SCRIPT_PATH = os.path.join(os.path.dirname(__file__), 'trigger_airflow.sh')


kafka_producer = KafkaProducer(
    bootstrap_servers=KAFKA_BOOTSTRAP,
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)


class AirflowAdapterService:
    """Airflow Adapter Service - Triggers Airflow DAGs and notifies Conductor"""
    
    def __init__(self):
        self.kafka_producer = kafka_producer
        self.script_path = SCRIPT_PATH
        
        # Ensure script is executable
        os.chmod(self.script_path, 0o755)
        
        logger.info(f"Airflow Adapter Service initialized")
        logger.info(f"   Script: {self.script_path}")


    def trigger_dag_run(self, jobid, session_id, metadata_url, execution_id, dag_id=None, stats_url=None):
        """Trigger Airflow DAG run and return dag_run_id"""
        dag_id= dag_id or 'nua-nameparse-process-stage-v02-00-06-tiny'
        max_retries=3
        backoff_seconds=2

        for attempt in range(1,max_retries+1):
            try:
                logger.info(f"Attempt No. {attempt}")
                logger.info(f"Triggering Airflow DAG")
                logger.info(f"DAG ID: {dag_id}")
                logger.info(f"Job ID: {jobid}")
                logger.info(f"Session ID: {session_id}")
                logger.info(f"Final Job ID: {jobid}-{session_id}")
                logger.info(f"Metadata URL: {metadata_url}")
                logger.info(f"Execution ID: {execution_id}")
     
                env = os.environ.copy()
                env.update({
                    'JOBID': jobid,
                    'SESSION_ID': session_id, 
                    'EXECUTION_ID': execution_id,
                    'DAG_ID': dag_id,
                    'STATS_URL':stats_url
                })
            
            # Pass MWAA config
                if MWAA_ENDPOINT:
                    env['MWAA_ENDPOINT'] = MWAA_ENDPOINT
                if MWAA_SESSION_TOKEN:
                    env['MWAA_SESSION_TOKEN'] = MWAA_SESSION_TOKEN
            
    
                logger.info(f"Executing trigger script: {self.script_path}")
                result = subprocess.run(
                    ['/bin/bash', self.script_path],
                    capture_output=True,
                    text=True,
                    timeout=60,
                    env=env
                )
         
                if result.stderr:
                    logger.info(f"Script output: {result.stderr.strip()}")

                if result.returncode == 0:
       
                    try:
                    # Clean stdout (remove any whitespace)
                        stdout_clean = result.stdout.strip()
                        logger.debug(f"Script JSON response: {stdout_clean}")
                    
                        response_data = json.loads(stdout_clean)
                    # Log the full response for debugging
                        logger.info(f"Full API response: {json.dumps(response_data, indent=2)}")
                
                        api_status = response_data.get('status')
                        if api_status is not None and api_status != 200:
                            error_detail = response_data.get('detail', 'Unknown error')
                            error_title = response_data.get('title', 'Error')
           
                            if api_status == 409:
                                match = re.search(r"DAGRun ID: '([^']+)'", error_detail)
                                if match:
                                    existing_dag_run_id = match.group(1)
                                    logger.warning(f"DAG run already exists (409 Conflict): {existing_dag_run_id}")
                                    logger.warning(f"   Will monitor existing DAG run instead of creating new one")
                                    return True, existing_dag_run_id
                                else:
                                # Fallback: use constructed dag_run_id
                                    constructed_dag_run_id = f"{jobid}-{session_id}"
                                    logger.warning(f"DAG run already exists (409 Conflict), using constructed ID: {constructed_dag_run_id}")
                                    return True, constructed_dag_run_id
                        
                        # For other errors, return failure
                            logger.error(f"Airflow API error (status {api_status}): {error_title}")
                            logger.error(f"   Detail: {error_detail}")
                            # return False, None
                    
                        if 'dag_run_id' not in response_data:
          
                            error_detail = response_data.get('detail', response_data.get('message', 'Unknown error'))
                            logger.error(f"Airflow API error: No dag_run_id in response")
                            logger.error(f"   Response: {error_detail}")
                            # return False, None
                    
              
                        dag_run_id = response_data.get('dag_run_id')
                    
                        logger.info(f"Airflow DAG triggered successfully via script")
                        logger.info(f"   DAG Run ID: {dag_run_id}")
                        logger.info(f"   Original Job ID: {jobid}")
                        return True, dag_run_id
                    except json.JSONDecodeError as e:
                  
                        logger.error(f"Could not parse script response as JSON: {e}")
                        logger.error(f"   Response was: {result.stdout}")
                        logger.warning(f"Using original jobid as dag_run_id (may not match actual DAG run)")
                        # return True, jobid
                else:
                    error_msg = f"Script execution failed with exit code {result.returncode}"
                    logger.error(f"{error_msg}")
                    logger.error(f"stderr: {result.stderr}")
                    logger.error(f"stdout: {result.stdout}")
                    # return False, None
                
            except subprocess.TimeoutExpired:
                error_msg = "Script execution timed out"
                logger.error(f"{error_msg}")
                # return False, None
            except Exception as e:
                error_msg = f"Error executing script: {e}"
                logger.error(f" {error_msg}")
                # return False, None
            
            time.sleep(backoff_seconds)
            backoff_seconds*=2

        logger.error("Failed to trigger DAG after retries")
        return False,None
    
    def publish_completion_event(self, workflow_id, task_id, dag_id, jobid, 
                                  status, error_message=None, metadata_url=None, event_type=None):
        
        try:
            if not event_type:
                if task_id and "name_parse" in task_id.lower():
                    event_type = "name_parse_completed"
                else:
                    event_type = "airflow_dag_completed"
            
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
                    "stats_url":"minio://name-parse-output/NameParse_Stats.jsonl" if status=="success" else None
                }
            }
            
     
            if metadata_url:
                completion_event["data"]["metadata_url"] = metadata_url
     
            if status == "failed" and error_message:
                completion_event["data"]["error"] = error_message

            self.kafka_producer.send('conductor-events', completion_event)
            self.kafka_producer.flush()
            
            logger.info(f"Published completion event to conductor-events for workflow {workflow_id}")
            logger.info(f"   Event Type: {event_type}")
            logger.info(f"   DAG: {dag_id}, Job: {jobid}, Status: {status}")
            
        except Exception as e:
            logger.error(f"Error publishing completion event: {e}", exc_info=True)

    def process_task_event(self, event):
        
        try:
            workflow_id = event.get('workflowId')
            task_id = event.get('taskId')
            
            data = event.get('data', {})

            dag_id = data.get('dag_id', 'nua-nameparse-process-stage-v02-00-06-tiny')
            execution_id = data.get('execution_id', 'WBNameParse')
            completion_event_type = data.get('completion_event_type')

            metadata_url = None  
            
            # Base job ID
            base_jobid = '1000861509'
 
            session_id = str(uuid.uuid4())[:8]
            
            logger.info(f"Processing Airflow trigger request")
            logger.info(f"   Workflow ID: {workflow_id}")
            logger.info(f"   Task ID: {task_id}")
            logger.info(f"   DAG ID: {dag_id}")
            logger.info(f"   Base Job ID: {base_jobid}")
            logger.info(f"   Session ID: {session_id}")
            logger.info(f"   Final Job ID: {base_jobid}-{session_id}")
            logger.info(f"   Metadata URL: {metadata_url}")
            logger.info(f"   Execution ID: {execution_id}")
            
            
            logger.info(f"Step 1: Triggering DAG run via script...")
            """Here we can create the stats url and pass it to trigger_dag_run fucntion"""
            stats_url=f"s3://{Config.S3_BUCKET}/{Config.S3_PREFIX}/runs/{workflow_id}/NameParse_Stats_URL.jsonl"
            trigger_success, dag_run_id = self.trigger_dag_run(
                jobid=base_jobid,
                session_id=session_id,
                metadata_url=metadata_url,
                execution_id=execution_id,
                dag_id=dag_id,
                stats_url=stats_url
            )
 
            if not trigger_success or not dag_run_id:
                logger.error(f" Failed to trigger DAG run via script")
                full_jobid = f"{base_jobid}-{session_id}"
                self.publish_completion_event(
                    workflow_id=workflow_id,
                    task_id=task_id,
                    dag_id=dag_id,
                    jobid=full_jobid,
                    status="failed",
                    error_message="Failed to trigger DAG run",
                    metadata_url=metadata_url,
                    event_type=completion_event_type
                )
                return
            
            monitor_event={
                "workflowId": workflow_id,
                "taskId": task_id,
                "metadata_key": f"conductor-poc/dp_name_parse.json",
                "minio_output_bucket":"name-parse-output",
                "minio_output_key":f"nameparse.out",
                "event_type":"name_parse_completed",
                "data": {
                    "dag_id": dag_id,
                    "dag_run_id": dag_run_id,
                    "jobid": f"{base_jobid}-{session_id}",
                    "stats_url": stats_url,
                    "execution_id": execution_id
                    }
                }
            self.kafka_producer.send(DAG_MONITOR_TOPIC, monitor_event)
            self.kafka_producer.flush()
            logger.info(f"DAG Monitor event published")
            logger.info(f"Dag run id : {dag_run_id}")
            logger.info(f"Event Has Been Passed to dag-monitor-worker to monitor its further execution.")
        except Exception as e:
            logger.error(f"Error processing Airflow task event: {e}", exc_info=True)
            
            # Publish failure event
            workflow_id = event.get('workflowId', 'unknown')
            task_id = event.get('taskId', 'unknown')
            event_data = event.get('data', {})
            completion_event_type = event_data.get('completion_event_type')
            
            self.publish_completion_event(
                workflow_id=workflow_id,
                task_id=task_id,
                dag_id=event_data.get('dag_id', 'unknown'),
                jobid='unknown',
                status='failed',
                error_message=str(e),
                metadata_url=None,
                event_type=completion_event_type
            )
    
    def consume_task_events(self):
        """Consume task events from Kafka"""
        consumer = KafkaConsumer(
            'airflow-trigger-requests',
            bootstrap_servers=KAFKA_BOOTSTRAP,
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            auto_offset_reset='latest',
            group_id=f'{SERVICE_NAME}-group'
        )
        
        logger.info(f"{SERVICE_NAME} started - listening for Airflow trigger events")
        logger.info(f"   Kafka Topic: airflow-trigger-requests")
        
        for message in consumer:
            try:
                event = message.value
                
                # Handle both JSON object and string cases
                if isinstance(event, str):
                    try:
                        event = json.loads(event)
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse JSON string: {event}")
                        continue
                
                event_type = event.get('eventType', 'unknown')
                
                if event_type == 'airflow_trigger_request':
                    logger.info(f"Received Airflow trigger request")
                    self.process_task_event(event)
                else:
                    logger.warning(f"Ignoring event type: {event_type}")
                    
            except Exception as e:
                logger.error(f"Error processing message: {e}", exc_info=True)


def main():
    """Start the Airflow Adapter Service"""
    logger.info(f"Starting {SERVICE_NAME} Service")
    logger.info(f"Kafka: {KAFKA_BOOTSTRAP}")
    

    logger.info("Waiting 10 seconds for services to initialize...")
    time.sleep(10)
    

    service = AirflowAdapterService()
    service.consume_task_events()


if __name__ == '__main__':
    main()
