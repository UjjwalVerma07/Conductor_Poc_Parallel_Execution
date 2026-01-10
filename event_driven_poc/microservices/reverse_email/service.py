# /usr/bin/env python


import os 
import json 
import time 
import subprocess
import logging
import requests
from kafka import KafkaConsumer, KafkaProducer


logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s')

logger=logging.getLogger(__name__)


KAFKA_BOOTSTRAP=os.getenv('KAFKA_BOOTSTRAP','localhost:9092')
SERVICE_NAME=os.getenv('SERVICE_NAME','email_hygiene_service')


MWAA_ENDPOINT = os.getenv('MWAA_ENDPOINT', 'https://a53c6d7a-ec07-465a-9824-6cc199145a7a-vpce.c75.us-east-1.airflow.amazonaws.com:443')
MWAA_SESSION_TOKEN = os.getenv('MWAA_SESSION_TOKEN', '')


DAG_POLL_INTERVAL = int(os.getenv('DAG_POLL_INTERVAL', '10')) 
DAG_MAX_WAIT_TIME = int(os.getenv('DAG_MAX_WAIT_TIME', '3600')) 

SCRIPT_PATH1=os.path.join(os.path.dirname(__file__),'trigger_match.sh')
SCRIPT_PATH2=os.path.join(os.path.dirname(__file__),'trigger_append.sh')

kafka_producer=KafkaProducer(
    bootstrap_servers=KAFKA_BOOTSTRAP,
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

class ReverseEmailService:
   

    def __init__(self):
        self.kafka_producer=kafka_producer
        self.script_path1=SCRIPT_PATH1
        self.script_path2=SCRIPT_PATH2

        os.chmod(self.script_path1, 0o755) 
        os.chmod(self.script_path2,0o755)
        

    def trigger_dag_run(self, script_name, jobid, session_id, metadata_url, execution_id, dag_id, stats_url=None):
 
        try:
            script_path = os.path.join(os.path.dirname(__file__), script_name)
            os.chmod(script_path, 0o755)

            logger.info(f"Executing script: {script_path}")

            env = os.environ.copy()
            env.update({
            'JOBID': jobid,
            'SESSION_ID': session_id,
            'EXECUTION_ID': execution_id,
            'DAG_ID': dag_id,
            'METADATA_URL': metadata_url or "",
            })

            if stats_url:
                env['STATS_URL'] = stats_url

       
            if MWAA_ENDPOINT:
                env['MWAA_ENDPOINT'] = MWAA_ENDPOINT
            if MWAA_SESSION_TOKEN:
                env['MWAA_SESSION_TOKEN'] = MWAA_SESSION_TOKEN

            result = subprocess.run(
                ['/bin/bash', script_path], 
                capture_output=True, 
                text=True,
                timeout=60,
                env=env
            )

            if result.stderr:
                logger.info(result.stderr.strip())

            if result.returncode != 0:
                logger.error(f"Script failed with exit code {result.returncode}")
                logger.error(f"stderr: {result.stderr}")
                return False, None

            try:
                response_json = json.loads(result.stdout.strip())
                dag_run_id = response_json.get("dag_run_id")

                if not dag_run_id:
                    logger.error("API returned no dag_run_id")
                    return False, None

                logger.info(f"DAG triggered successfully: Run ID = {dag_run_id}")
                return True, dag_run_id

            except json.JSONDecodeError:
                logger.error("Failed to decode JSON response")
                logger.error(result.stdout)
                return False, None

        except Exception as e:
            logger.error(f"Error executing trigger script: {e}", exc_info=True)
            return False, None


    
    def check_dag_run_status(self,dag_id,dag_run_id):
        
        try:
            endpoint=MWAA_ENDPOINT
            session_token=MWAA_SESSION_TOKEN

            if not session_token:
                logger.error("MWAA_SESSION_TOKEN not configured.")
                return None,"Session token not configured."
            api_url=f"{endpoint}/api/v1/dags/{dag_id}/dagRuns/{dag_run_id}"

            response=requests.get(
                api_url,
                cookies={'session':session_token},
                headers={'Content-Type':'application/json'},
                timeout=30
            )
            if response.status_code==200:
                dag_run_data=response.json()
                state=dag_run_data.get('state','unknown')
                return state,None
            elif response.status_code==404:
                return None,f"DAG run {dag_run_id} not found."
            else:
                return None, f"API error: {response.status_code} - {response.text}"
                
        except requests.exceptions.RequestException as e:
            return None, f"Network error: {str(e)}"
        except Exception as e:
            return None, f"Error checking status: {str(e)}"


    
    def wait_for_dag_completion(self,dag_id,dag_run_id,timeout=None):
        

        timeout=timeout or DAG_MAX_WAIT_TIME
        start_time=time.time()
        poll_interval=DAG_POLL_INTERVAL

        logger.info(f"Monitoring DAG run: {dag_run_id}")
        logger.info(f"   Poll interval: {poll_interval}s, Max wait: {timeout}s")

        while True:
            elapsed=time.time()-start_time
            if elapsed > timeout:
                logger.error(f"Timout waiting for DAG run to complete ({timeout}s)")
                return False,'timeout',f"DAG run did not complete within {timeout} seconds."
            
            state,error=self.check_dag_run_status(dag_id,dag_run_id)
            if error:
                logger.error(f"Error checking DAG run status: {error}")
                return False,'error',error
            
            if state is None:
                logger.info(f"Could not determin DAG run status")
                time.sleep(poll_interval)
                continue
            logger.info(f"DAG Run Status: {state} (elapsed: {int(elapsed)}s)")

            if state in ['success','failed','skipped','upstream_failed']:
                if state=='success':
                    return True,state,None
                else:
                    logger.error(f"DAG run completed with state: {state}")
                    return False,state,f"DAG run completed with state: {state}" 

            if state in ['queued', 'running', 'up_for_retry', 'up_for_reschedule']:
                time.sleep(poll_interval)
                continue
            
            # Unknown state
            logger.warning(f"Unknown DAG run state: {state}, continuing to monitor...")
            time.sleep(poll_interval) 


    def publish_completion_event(self,workflow_id,task_id,match_dag_id,append_dag_id,jobid,status,error_message,metadata_url):
 
        event_type="reverse_email_completed"
        event={
            "eventType":event_type,
            "workflowId":workflow_id,
            "taskId":task_id,
            "data":{
                "match_dagId":match_dag_id,
                "append_dagId":append_dag_id,
                "jobid":jobid,
                "status":status,
                "result":"success" if status=="success" else "failure",
                "errorMessage":error_message,
                "metadataUrl":metadata_url,
                "pipelineStage":"reverse_email",
                "timestamp":time.strftime("%Y-%m-%dT%H:%M:%SZ")
            }
        }

        self.kafka_producer.send('conductor-events',value=event)
        self.kafka_producer.flush()
        logger.info(f"Published Reverse Email completion event for Workflow ID: {workflow_id}, Task ID: {task_id}, Status: {status}")
        logger.info(f"Event Type:{event_type}")
        logger.info(f"Match DAG ID:{match_dag_id}, Append DAG ID:{append_dag_id}, Job ID:{jobid}")

    def process_task_event(self, event):
      
        try:
            workflow_id = event.get("workflowId")
            task_id = event.get("taskId")
            data = event.get("data", {})

            match_dag_id = data.get("match_dagId", "nua-match-process-stage-v01-01-04-tiny")
            append_dag_id = data.get("append_dagId", "nua-append-process-stage-v01-01-02-tiny")
            match_exec_id = data.get("match_executionId", "WBReverseEmail_Match")
            append_exec_id = data.get("append_executionId", "WBReverseEmail_Append")

            match_metadata_url = data.get("match_metadata_url")
            append_metadata_url = data.get("append_metadata_url")

            base_jobid = "1001013123"
            session_id = f"{abs(hash(workflow_id)) % 10000:04d}"

            logger.info("==== Reverse Email Process Started ====")
            logger.info(f"Workflow ID: {workflow_id}, Task ID: {task_id}")
            logger.info(f"Session ID: {session_id}, Base Job ID: {base_jobid}")

       
            logger.info("Triggering MATCH DAG script...")
            match_success, match_dag_run_id = self.trigger_dag_run(
            script_name="trigger_match.sh",
            jobid=base_jobid,
            session_id=session_id,
            metadata_url=match_metadata_url,
            execution_id=match_exec_id,
            dag_id=match_dag_id
            ) 

            if not match_success or not match_dag_run_id:
                self.publish_completion_event(
                workflow_id, task_id,
                match_dag_id, append_dag_id,
                jobid=f"{base_jobid}-{session_id}",
                status="failed",
                error_message="MATCH DAG trigger failed",
                metadata_url=match_metadata_url
                )
                return

        
            logger.info("Waiting for MATCH DAG to complete...")
            dag_success, final_state, error_message = self.wait_for_dag_completion(
                dag_id=match_dag_id,
                dag_run_id=match_dag_run_id
            ) 

            if not dag_success:
                self.publish_completion_event(
                workflow_id, task_id,
                match_dag_id, append_dag_id,
                jobid=f"{base_jobid}-{session_id}",
                status="failed",
                error_message=f"MATCH DAG failed with state: {final_state}",
                metadata_url=match_metadata_url
                )
                return

        
            logger.info("MATCH DAG succeeded, triggering APPEND DAG script...")
            append_success, append_dag_run_id = self.trigger_dag_run(
                script_name="trigger_append.sh",
                jobid=base_jobid,
                session_id=session_id, 
                metadata_url=append_metadata_url,
                execution_id=append_exec_id,
                dag_id=append_dag_id
            ) 

            if not append_success or not append_dag_run_id:
                self.publish_completion_event(
                workflow_id, task_id,
                match_dag_id, append_dag_id,
                jobid=f"{base_jobid}-{session_id}",
                status="failed",
                error_message="APPEND DAG trigger failed",
                metadata_url=append_metadata_url
                )
                return

       
            logger.info("Waiting for APPEND DAG to complete...")
            dag_success, final_state, error_message = self.wait_for_dag_completion(
                dag_id=append_dag_id,
                dag_run_id=append_dag_run_id
            )

        
            self.publish_completion_event(
                workflow_id, task_id,
                match_dag_id, append_dag_id,
                jobid=f"{base_jobid}-{session_id}",
                status="success" if dag_success else "failed",
                error_message=error_message,
                metadata_url=append_metadata_url
            )

            logger.info(f"Reverse Email task completed: Status = {'success' if dag_success else 'failed'}")

        except Exception as e:
            logger.error(f"Error processing event: {e}", exc_info=True)
            self.publish_completion_event(
            workflow_id=event.get("workflowId", "unknown"),
            task_id=event.get("taskId", "unknown"),
            match_dag_id='unknown',
            append_dag_id='unknown',
            jobid='unknown',
            status="failed",
            error_message=str(e),
            metadata_url=None
            )



    
    def consume_task_events(self):
    
        consumer=KafkaConsumer(
            'reverse-email-requests',
            bootstrap_servers=KAFKA_BOOTSTRAP,
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            auto_offset_reset="latest",
            group_id=f"{SERVICE_NAME}-group"
        )

        logger.info("Listening for Reverse Email task events...")
        logger.info(f"Kafka Topic: reverse-email-requests")

        for message in consumer:
            try:
                event=message.value

                if isinstance(event,str):
                    try:
                        event=json.loads(event)
                    except json.JSONDecodeError:
                        logger.error(f"Invalid JSON string received: {event}")
                        continue
                event_type=event.get('eventType','reverse_email_requests')
                if event_type=="reverse_email_requests":
                    self.process_task_event(event)
                else:
                    logger.warning(f"Unknown event type received: {event_type}")
            except Exception as e:
                logger.error(f"Error processing message: {e}",exc_info=True)
    
def main():
    logger.info("Starting Reverse Email Service...")
    logger.info(f"Kafka Bootstrap Servers: {KAFKA_BOOTSTRAP}")

    logger.info("Waiting 10 secods for services to initialize...")
    time.sleep(10)

    service=ReverseEmailService()
    service.consume_task_events()


if __name__ == "__main__":
    main()