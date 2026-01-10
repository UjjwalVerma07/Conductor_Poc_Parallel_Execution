#!/usr/bin/env python3


import os
import json
import time
import logging
import pandas as pd
import random
from kafka import KafkaConsumer, KafkaProducer
from minio import Minio
from minio.error import S3Error
import io


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


KAFKA_BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP', 'localhost:9092')
SERVICE_NAME = os.getenv('SERVICE_NAME', 'enricher')
MINIO_ENDPOINT = os.getenv('MINIO_ENDPOINT', 'minio:9000')
MINIO_ACCESS_KEY = os.getenv('MINIO_ACCESS_KEY', 'minioadmin')
MINIO_SECRET_KEY = os.getenv('MINIO_SECRET_KEY', 'minioadmin')
MINIO_BUCKET = os.getenv('MINIO_BUCKET', 'enrichment')


kafka_producer = KafkaProducer(
    bootstrap_servers=KAFKA_BOOTSTRAP,
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

class EnricherService:
 
    
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
                logger.info(f" Created bucket: {MINIO_BUCKET}")
        except S3Error as e:
            logger.error(f" Error creating bucket: {e}")
    
    def _ensure_output_bucket_exists(self, bucket_name):
      
        try:
            if not self.minio_client.bucket_exists(bucket_name):
                self.minio_client.make_bucket(bucket_name)
                logger.info(f" Created output bucket: {bucket_name}")
            else:
                logger.info(f" Output bucket exists: {bucket_name}")
        except S3Error as e:
            logger.error(f" Error creating output bucket: {e}")
    
    def download_file(self, bucket, key):

        try:
            response = self.minio_client.get_object(bucket, key)
            data = response.read()
            response.close()
            response.release_conn()
            logger.info(f" Downloaded file: {bucket}/{key}")
            return data
        except S3Error as e:
            logger.error(f" Error downloading file {bucket}/{key}: {e}")
            raise
    
    def upload_file(self, bucket, key, data):
     
        try:
            data_stream = io.BytesIO(data)
            self.minio_client.put_object(
                bucket, key, data_stream, len(data)
            )
            logger.info(f"Uploaded file: {bucket}/{key}")
        except S3Error as e:
            logger.error(f" Error uploading file {bucket}/{key}: {e}")
            raise
    
    def enrich_data(self, df):
    
        try:
            
            df['customer_segment'] = df.apply(lambda x: self._get_customer_segment(x), axis=1)
            df['risk_score'] = df.apply(lambda x: self._calculate_risk_score(x), axis=1)
            df['enrichment_timestamp'] = time.strftime('%Y-%m-%dT%H:%M:%SZ')
            
            return df
        except Exception as e:
            logger.error(f" Error enriching data: {e}")
            raise
    
    def _get_customer_segment(self, row):
    
        segments = ['Premium', 'Standard', 'Basic']
        return random.choice(segments)
    
    def _calculate_risk_score(self, row):

        return round(random.uniform(0.1, 1.0), 2)
    
    def process_csv_file(self, csv_data):

        try:
           
            df = pd.read_csv(io.BytesIO(csv_data))
            logger.info(f" Processing CSV with {len(df)} rows")
            
           
            enriched_df = self.enrich_data(df)
            
            
            total_records = len(enriched_df)
            enriched_records = total_records 
            
           
            output_csv = enriched_df.to_csv(index=False)
            
            logger.info(f" Data enrichment completed: {enriched_records} records enriched")
            return output_csv.encode('utf-8'), enriched_records, 0
            
        except Exception as e:
            logger.error(f" Error processing CSV: {e}")
            raise
    
    def process_task_event(self, event):
        """Process task event with MinIO file operations"""
        try:
            workflow_id = event.get('workflowId')
            task_id = event.get('taskId')
            data = event.get('data', {})
     
            input_bucket = data.get('input_bucket')
            input_key = data.get('input_key')
            output_bucket = data.get('output_bucket')
            output_key = data.get('output_key')
            
  
            if output_key and 'null' in output_key:
                output_key = f'enriched_{workflow_id}.csv'
            
            logger.info(f" Processing data enrichment for workflow {workflow_id}")
            logger.info(f" Input: {input_bucket}/{input_key}")
            logger.info(f" Output: {output_bucket}/{output_key}")
            

            logger.info(" Sleeping for 10 seconds to simulate processing time...")
            time.sleep(10)
            logger.info(" Sleep completed, continuing with processing...")
            

            self._ensure_output_bucket_exists(output_bucket)
            
      
            input_data = self.download_file(input_bucket, input_key)
        
            output_data, enriched_count, failed_count = self.process_csv_file(input_data)
            
       
            self.upload_file(output_bucket, output_key, output_data)
            
    
            result_event = {
                "workflowId": workflow_id,
                "taskId": task_id,
                "eventType": "enrichment_completed",
                "data": {
                    "input_bucket": input_bucket,
                    "input_key": input_key,
                    "output_bucket": output_bucket,
                    "output_key": output_key,
                    "result": "success",
                    "status":"success",
                    "processedRecords": int(enriched_count),
                    "failedRecords": int(failed_count),
                    "pipelineStage": "enrichment",
                    "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ')
                }
            }
            
          
            self.kafka_producer.send('conductor-events', result_event)
   
            self.kafka_producer.flush()
            
            logger.info(f" Data enrichment completed: {enriched_count} records enriched")
            
        except Exception as e:
            logger.error(f" Error processing data enrichment: {e}", exc_info=True)
            
          
            failure_event = {
                "workflowId": event.get('workflowId', 'unknown'),
                "taskId": event.get('taskId', 'unknown'),
                "eventType": "enrichment_completed",
                "data": {
                    "status":"failed",
                    "result": "failure",
                    "error": str(e),
                    "pipelineStage": "enrichment",
                    "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ')
                }
            }
            
          
            self.kafka_producer.send('conductor-events', failure_event)
            self.kafka_producer.flush()
    
    def consume_task_events(self):
   
        consumer = KafkaConsumer(
            'enrichment-requests',
            bootstrap_servers=KAFKA_BOOTSTRAP,
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            auto_offset_reset='latest',
            group_id=f'{SERVICE_NAME}-group'
        )
        
        logger.info(f" {SERVICE_NAME} started - listening for enrichment events")
        
        for message in consumer:
            try:
                event = message.value
                
                if isinstance(event, str):
                    try:
                        event = json.loads(event)
                    except json.JSONDecodeError:
                        logger.error(f" Failed to parse JSON string: {event}")
                        continue
                
                event_type = event.get('eventType', 'unknown')
                
                if event_type == 'enrichment_request':
                    logger.info(f" Processing enrichment request")
                    self.process_task_event(event)
                else:
                    logger.warning(f" Ignoring event type: {event_type}")
                    
            except Exception as e:
                logger.error(f" Error processing message: {e}", exc_info=True)

def main():
    """Start the Enricher Service"""
    logger.info(f" Starting {SERVICE_NAME} Service")
    logger.info(f" Kafka: {KAFKA_BOOTSTRAP}")
    logger.info(f" MinIO: {MINIO_ENDPOINT}")
    

    logger.info(" Waiting 10 seconds for services to initialize...")
    time.sleep(10)
    

    service = EnricherService()
    service.consume_task_events()

if __name__ == '__main__':
    main()