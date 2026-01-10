#!/usr/bin/env python3
import os
import json
import time
import logging
import requests
from kafka import KafkaConsumer


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


KAFKA_BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP', 'localhost:9092')
CONDUCTOR_API = os.getenv('CONDUCTOR_API', 'http://conductor-server:8080/api')

EVENT_TO_TASK_MAPPING = {
    'email_validation_completed': 'wait_for_email_completion',
    'phone_validation_completed': 'wait_for_phone_completion',
    'enrichment_completed': 'wait_for_enrichment_completion',
    'airflow_dag_completed': 'wait_for_airflow_completion',
    'airflow_completed': 'wait_for_airflow_completion'  
}

class ScalableEventRouter:
    """Scalable router that consumes from Kafka and completes EVENT tasks"""
    
    def __init__(self):
        self.conductor_api = CONDUCTOR_API
        self.event_to_task_map = EVENT_TO_TASK_MAPPING  
        
    def extract_event_type(self, event):

        event_field = event.get('event', '')
        if event_field and ':' in event_field:

            parts = event_field.split(':')
            if len(parts) >= 3:
                return parts[-1]  
        
        event_type = event.get('eventType', '')
        if event_type:
         
            if '_completed' not in event_type and '_request' in event_type:
                return event_type.replace('_request', '_completed')
            return event_type
        
        return None
    
    def normalize_sink_to_event_type(self, sink):
        if not sink:
            return None
        
        if ':' in sink:
            parts = sink.split(':')
            if len(parts) >= 2:
        
                return parts[-1]
        
        return sink
    
    def find_matching_event_task(self, workflow_id, event_type, task_id_from_event=None, max_retries=5, retry_delay=2):
        
        for attempt in range(max_retries):
            try:
                url = f"{self.conductor_api}/workflow/{workflow_id}?includeTasks=true"
                response = requests.get(url, timeout=5)
                if response.status_code != 200:
                    if attempt < max_retries - 1:
                        time.sleep(retry_delay)
                        continue
                    logger.warning(f"Could not get workflow: {response.status_code}")
                    return None, None, None
                
                workflow_data = response.json()
                tasks = workflow_data.get('tasks', [])
                
         
                if task_id_from_event:
                    matching_task = next((t for t in tasks if t.get('taskId') == task_id_from_event), None)
                    if matching_task and matching_task.get('taskType') == 'EVENT':
                        task_id = matching_task.get('taskId')
                        task_ref_name = matching_task.get('referenceTaskName')
                        task_status = matching_task.get('status', 'UNKNOWN')
                        return task_id, task_ref_name, task_status 
                
           
                in_progress_event_tasks = [
                    t for t in tasks 
                    if t.get('taskType') == 'EVENT' and t.get('status') == 'IN_PROGRESS'
                ]
            
                normalized_event_type = event_type.lower() if event_type else None
                
                for task in in_progress_event_tasks:
        
                    task_sink = task.get('inputData', {}).get('sink') or task.get('sink')
                    
                    if task_sink:
                   
                        sink_event_type = self.normalize_sink_to_event_type(task_sink)
                        
               
                        if sink_event_type and normalized_event_type:
                      
                            if sink_event_type.lower() == normalized_event_type.lower():
                                task_id = task.get('taskId')
                                task_ref_name = task.get('referenceTaskName')
                                task_status = task.get('status', 'UNKNOWN')
                                logger.info(f"Found matching EVENT task by sink: {task_ref_name} (sink: {task_sink})")
                                return task_id, task_ref_name, task_status
                     
                            if normalized_event_type in sink_event_type.lower() or sink_event_type.lower() in normalized_event_type:
                                task_id = task.get('taskId')
                                task_ref_name = task.get('referenceTaskName')
                                task_status = task.get('status', 'UNKNOWN')
                                logger.info(f"Found matching EVENT task by partial sink match: {task_ref_name} (sink: {task_sink})")
                                return task_id, task_ref_name, task_status
                

                task_ref_name = self.event_to_task_map.get(event_type)
                if task_ref_name:
                    matching_task = next((t for t in tasks if t.get('referenceTaskName') == task_ref_name), None)
                    if matching_task and matching_task.get('taskType') == 'EVENT':
                        task_id = matching_task.get('taskId')
                        task_status = matching_task.get('status', 'UNKNOWN')
                        logger.info(f" Found EVENT task using fallback mapping: {task_ref_name}")
                        return task_id, task_ref_name, task_status
                
       
                if attempt < max_retries - 1:
                    logger.debug(f"EVENT task for event type '{event_type}' not found yet, retrying in {retry_delay}s... (attempt {attempt + 1}/{max_retries})")
                    time.sleep(retry_delay)
                    continue
                else:
                    logger.warning(f" No matching EVENT task found for event type '{event_type}' after {max_retries} attempts")
                    logger.debug(f"   Available IN_PROGRESS EVENT tasks: {[t.get('referenceTaskName') for t in in_progress_event_tasks]}")
                    return None, None, None
                    
            except Exception as e:
                logger.warning(f"Error finding EVENT task (attempt {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                    continue
                return None, None, None
        
        return None, None, None
    
    
    def complete_event_task(self, workflow_id, task_id, output_data, status='COMPLETED'):
        try:
            response = requests.post(
                f"{self.conductor_api}/tasks",
                json={
                    "workflowInstanceId": workflow_id,
                    "taskId": task_id,
                    "status": status,
                    "outputData": output_data
                },
                timeout=5
            )
            return response.status_code in [200, 204]
        except Exception as e:
            logger.error(f"Error completing task: {e}", exc_info=True)
            return False
    
    def process_completion_event(self, event):
        try:
            workflow_id = event.get('workflowInstanceId') or event.get('workflowId')
            if not workflow_id:
                logger.warning("Event missing workflowId/workflowInstanceId, skipping")
                return
            
          
            event_type = self.extract_event_type(event)
            if not event_type:
                logger.warning(f"Could not extract event type from event: {event.get('event', event.get('eventType', 'unknown'))}")
                return
            
      
            task_id_from_event = event.get('taskId')
            
            logger.info(f"Processing completion event: {event_type} for workflow {workflow_id}")
            if task_id_from_event:
                logger.info(f"   Task ID from event: {task_id_from_event}")
            
    
            task_id, task_ref_name, task_status = self.find_matching_event_task(
                workflow_id, 
                event_type, 
                task_id_from_event=task_id_from_event
            )
            
            if not task_id:
                logger.warning(f" No matching EVENT task found for event type '{event_type}' in workflow {workflow_id}")
                return
            
            if task_status != 'IN_PROGRESS':
                logger.warning(f"EVENT task '{task_ref_name}' status is {task_status}, not IN_PROGRESS. Skipping.")
                return
            
       
            event_data = event.get('data', {})
            output_data = event_data.copy()  
            
       
            result = event_data.get('result', 'success')
            status = 'COMPLETED' if result == 'success' else 'FAILED'
            
            
            success = self.complete_event_task(workflow_id, task_id, output_data, status)
            if success:
                logger.info(f"Completed EVENT task '{task_ref_name}' for workflow {workflow_id}")
                logger.info(f"   Event type: {event_type}, Status: {status}")
            else:
                logger.error(f" Failed to complete EVENT task '{task_ref_name}' for workflow {workflow_id}")
                
        except Exception as e:
            logger.error(f" Error processing completion event: {e}", exc_info=True)
    
    def consume_and_complete(self):
       
        consumer = KafkaConsumer(
            'conductor-events',
            bootstrap_servers=KAFKA_BOOTSTRAP,
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            auto_offset_reset='latest',
            group_id='scalable-event-router-group',
            enable_auto_commit=True,
            auto_commit_interval_ms=1000
        )
        logger.info("Started consuming events from Kafka topic 'conductor-events'")
        
        for message in consumer:
            try:
                event = message.value
                
    
                if isinstance(event, str):
                    try:
                        event = json.loads(event)
                    except json.JSONDecodeError:
                        logger.warning(f"Failed to parse JSON string: {event[:100]}")
                        continue
                
             
                event_str = event.get('event', '')
                event_type_str = event.get('eventType', '')
                
          
                is_completion = (
                    ('_completed' in event_str) or 
                    ('_completed' in event_type_str) or
                    (event.get('data', {}).get('result') in ['success', 'failure'])
                )
                
                if is_completion:
                    self.process_completion_event(event)
                else:
                    logger.debug(f"Skipping non-completion event: {event_str or event_type_str}")
                
            except Exception as e:
                logger.error(f" Error processing message: {e}", exc_info=True)

def main():

    logger.info("Starting Scalable Conductor Event Router Service")
    logger.info(f" Kafka: {KAFKA_BOOTSTRAP}")
    logger.info(f" Conductor: {CONDUCTOR_API}")
    
    
    logger.info(" Waiting 10 seconds for services to initialize...")
    time.sleep(10)
    

    router = ScalableEventRouter()
    router.consume_and_complete()

if __name__ == '__main__':
    main()

