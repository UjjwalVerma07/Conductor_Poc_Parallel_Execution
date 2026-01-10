#!/usr/bin/env python3


import os
import json
import time
import logging
import pandas as pd
import re
from kafka import KafkaConsumer, KafkaProducer
from minio import Minio
from minio.error import S3Error
import io


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

FAIL_ONCE = True

KAFKA_BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP', 'localhost:9092')
SERVICE_NAME = os.getenv('SERVICE_NAME', 'email-validator')
MINIO_ENDPOINT = os.getenv('MINIO_ENDPOINT', 'minio:9000')
MINIO_ACCESS_KEY = os.getenv('MINIO_ACCESS_KEY', 'minioadmin')
MINIO_SECRET_KEY = os.getenv('MINIO_SECRET_KEY', 'minioadmin')
MINIO_BUCKET = os.getenv('MINIO_BUCKET', 'email-validation')


kafka_producer = KafkaProducer(
    bootstrap_servers=KAFKA_BOOTSTRAP,
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

class EmailValidatorService:
 
    
    def __init__(self):
        self.kafka_producer = kafka_producer
        self.minio_client = Minio(
            MINIO_ENDPOINT,
            access_key=MINIO_ACCESS_KEY,
            secret_key=MINIO_SECRET_KEY,
            secure=False
        )
        self._ensure_bucket_exists()
    
    def _ensure_bucket_exists(self):
     
        try:
            if not self.minio_client.bucket_exists(MINIO_BUCKET):
                self.minio_client.make_bucket(MINIO_BUCKET)
                logger.info(f"Created bucket: {MINIO_BUCKET}")
            else:
                logger.info(f"Bucket exists: {MINIO_BUCKET}")
        except S3Error as e:
            logger.error(f"Error creating bucket: {e}")
    
    def _ensure_output_bucket_exists(self, bucket_name):

        try:
            if not self.minio_client.bucket_exists(bucket_name):
                self.minio_client.make_bucket(bucket_name)
                logger.info(f"Created output bucket: {bucket_name}")
            else:
                logger.info(f"Output bucket exists: {bucket_name}")
        except S3Error as e:
            logger.error(f"Error creating output bucket: {e}")
    
    def download_file(self, bucket, key):
      
        try:
            response = self.minio_client.get_object(bucket, key)
            data = response.read()
            response.close()
            response.release_conn()
            logger.info(f"Downloaded file: {bucket}/{key}")
            return data
        except S3Error as e:
            logger.error(f"Error downloading file {bucket}/{key}: {e}")
            raise
    
    def upload_file(self, bucket, key, data):
 
        try:
            data_stream = io.BytesIO(data)
            self.minio_client.put_object(
                bucket, key, data_stream, len(data)
            )
            logger.info(f"Uploaded file: {bucket}/{key}")
        except S3Error as e:
            logger.error(f"Error uploading file {bucket}/{key}: {e}")
            raise
    
    def validate_email(self, email):

        pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        return re.match(pattern, email) is not None
    
    def process_csv_file(self, csv_data):
  
        try:
       
            df = pd.read_csv(io.BytesIO(csv_data))
            logger.info(f"Processing CSV with {len(df)} rows")
            
   
            if 'email' not in df.columns:
                logger.error("No 'email' column found in CSV")
                return None, 0, 0
            
       
            df['email_valid'] = df['email'].apply(self.validate_email)
            
            
            total_records = len(df)
            valid_emails = df['email_valid'].sum()
            invalid_emails = total_records - valid_emails
            
       
            valid_df = df[df['email_valid'] == True].drop('email_valid', axis=1)
            

            output_csv = valid_df.to_csv(index=False)
            
            logger.info(f"Email validation completed: {valid_emails}/{total_records} valid")
            return output_csv.encode('utf-8'), valid_emails, invalid_emails
            
        except Exception as e:
            logger.error(f"Error processing CSV: {e}")
            raise
    
    def process_task_event(self, event):
        global FAIL_ONCE
        
        try:
            if FAIL_ONCE:
                FAIL_ONCE = False
                raise Exception("Intentional first-time failure to test retry")
            workflow_id = event.get('workflowId')
            task_id = event.get('taskId')
            data = event.get('data', {})
            

            input_bucket = data.get('input_bucket')
            input_key = data.get('input_key')
            output_bucket = data.get('output_bucket')
            output_key = data.get('output_key')
            

            logger.info(f"Before fix - output_key: {output_key}")
            if output_key and 'null' in output_key:
                output_key = f'email_validated_{workflow_id}.csv'
                logger.info(f"Fixed output_key to: {output_key}")
            else:
                logger.info(f"No fix needed - output_key: {output_key}")
            
            logger.info(f"Processing email validation for workflow {workflow_id}")
            logger.info(f"Input: {input_bucket}/{input_key}")
            logger.info(f"Output: {output_bucket}/{output_key}")
            logger.info(f"Raw data received: {data}")
            
   
            logger.info("Sleeping for 10 seconds to simulate processing time...")
            time.sleep(10)
            logger.info("Sleep completed, continuing with processing...")
            

            self._ensure_output_bucket_exists(output_bucket)
            
      
            input_data = self.download_file(input_bucket, input_key)
            
 
            output_data, valid_count, invalid_count = self.process_csv_file(input_data)
            
           
            self.upload_file(output_bucket, output_key, output_data)
            
           
            result_event = {
                       "workflowId": workflow_id,
                       "taskId": task_id,
                       "eventType": "email_validation_completed", 
                       "data": {
                           "input_bucket": input_bucket,
                           "input_key": input_key, 
                           "output_bucket": output_bucket,
                           "output_key": output_key,
                           "result": "success",
                           "status":"success",
                           "processedRecords": int(valid_count),
                           "failedRecords": int(invalid_count),
                           "pipelineStage": "email_validation",
                           "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ')
                       }
                   }
            

            try:
                future = self.kafka_producer.send(
                    'conductor-events',
                    key=workflow_id.encode('utf-8') if workflow_id else None,
                    value=result_event
                )
                
         
                record_metadata = future.get(timeout=10)
                logger.info(f"Published completion event to conductor-events for workflow {workflow_id}")
                logger.info(f"   Topic: {record_metadata.topic}, Partition: {record_metadata.partition}, Offset: {record_metadata.offset}")
            except Exception as e:
                logger.error(f"Error publishing event to conductor-events: {e}", exc_info=True)
            
            self.kafka_producer.flush()
            
            logger.info(f"Email validation completed: {valid_count} valid, {invalid_count} invalid")
            
        except Exception as e:
            logger.error(f"Error processing email validation: {e}", exc_info=True)
            
            # Publish failure event
            failure_event = {
                "workflowId": event.get('workflowId', 'unknown'),
                "taskId": event.get('taskId', 'unknown'),
                "eventType": "email_validation_completed", 
                "data": {
                    "status":"failed",
                    "result": "failure",
                    "error": str(e),
                    "pipelineStage": "email_validation",
                    "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ')
                }
            }

            try:
                workflow_id = event.get('workflowId', 'unknown')
                future = self.kafka_producer.send(
                    'conductor-events',
                    key=workflow_id.encode('utf-8') if workflow_id != 'unknown' else None,
                    value=failure_event
                )
                record_metadata = future.get(timeout=10)
                logger.info(f"Published failure event to conductor-events for workflow {workflow_id}")
            except Exception as e:
                logger.error(f"Error publishing failure event to conductor-events: {e}", exc_info=True)
            self.kafka_producer.flush()
    
    def consume_task_events(self):

        consumer = KafkaConsumer(
            'email-validation-requests',
            bootstrap_servers=KAFKA_BOOTSTRAP,
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            auto_offset_reset='latest',
            group_id=f'{SERVICE_NAME}-group'
        )
        
        logger.info(f"{SERVICE_NAME} started - listening for email validation events")
        
        for message in consumer:
            try:
                event = message.value
     
                if isinstance(event, str):
                    try:
                        event = json.loads(event)
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse JSON string: {event}")
                        continue
                
                event_type = event.get('eventType', 'unknown')
                
                if event_type == 'email_validation_request':
                    logger.info(f"Processing email validation request")
                    self.process_task_event(event)
                else:
                    logger.warning(f"Ignoring event type: {event_type}")
                    
            except Exception as e:
                logger.error(f"Error processing message: {e}", exc_info=True)

def main():

    logger.info(f"Starting {SERVICE_NAME} Service")
    logger.info(f"Kafka: {KAFKA_BOOTSTRAP}")
    logger.info(f"MinIO: {MINIO_ENDPOINT}")
    

    logger.info(" Waiting 10 seconds for services to initialize...")
    time.sleep(10)

    service = EmailValidatorService()
    service.consume_task_events()

if __name__ == '__main__':
    main()

