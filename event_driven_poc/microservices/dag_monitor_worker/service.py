import os 
import json 
import tempfile
import time
import uuid
import logging
import requests
import psycopg2
from psycopg2.extras import RealDictCursor
from kafka import KafkaConsumer, KafkaProducer
from s3_utils import S3Manager
from minio_utils import MinIOManager
from config import Config
import threading

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

logger = logging.getLogger(__name__)

s3_manager = S3Manager()
minio_manager = MinIOManager()
DAG_MONITOR_TOPIC = os.getenv("DAG_MONITOR_TOPIC", "dag-monitor-queue")
KAFKA_BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP', 'localhost:9092')
MWAA_ENDPOINT = os.getenv('MWAA_ENDPOINT')
MWAA_SESSION_TOKEN = os.getenv('MWAA_SESSION_TOKEN')
DAG_POLL_INTERVAL = int(os.getenv('DAG_POLL_INTERVAL', 10))
DAG_MAX_WAIT_TIME = int(os.getenv('DAG_MAX_WAIT_TIME', 3600))
SERVICE_NAME = os.getenv('SERVICE_NAME', 'dag-monitor-worker')
DB_POLL_INTERVAL = int(os.getenv('DB_POLL_INTERVAL', 15))  # Poll DB every 15 seconds

kafka_producer = KafkaProducer(
    bootstrap_servers=KAFKA_BOOTSTRAP,
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)


class DatabaseManager:
    """Manages PostgreSQL database connections and operations"""
    
    def __init__(self):
        self.connection_params = {
            'host': Config.DB_HOST,
            'port': Config.DB_PORT,
            'database': Config.DB_NAME,
            'user': Config.DB_USER,
            'password': Config.DB_PASSWORD
        }
        self.init_database()
    
    def get_connection(self):
        
        return psycopg2.connect(**self.connection_params)
    
    def init_database(self):
        
        max_retries = 10
        retry_delay = 5
        
        for attempt in range(1, max_retries + 1):
            try:
                logger.info(f"Attempting to connect to database (attempt {attempt}/{max_retries})...")
                conn = self.get_connection()
                cursor = conn.cursor()
                
                # Create table if not exists
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS dag_monitor_requests (
                        id SERIAL PRIMARY KEY,
                        workflow_id VARCHAR(255) NOT NULL,
                        task_id VARCHAR(255) NOT NULL,
                        dag_id VARCHAR(255) NOT NULL,
                        dag_run_id VARCHAR(255) NOT NULL,
                        jobid VARCHAR(255) NOT NULL,
                        execution_id VARCHAR(255),
                        metadata_key VARCHAR(500),
                        minio_output_bucket VARCHAR(255),
                        minio_output_key VARCHAR(255),
                        event_type VARCHAR(255),
                        stats_url TEXT,
                        status VARCHAR(50) DEFAULT 'pending',
                        error_message TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        started_monitoring_at TIMESTAMP,
                        completed_at TIMESTAMP
                    )
                """)
                
                # Create index for efficient querying
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_status 
                    ON dag_monitor_requests(status)
                """)
                
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_dag_run_id 
                    ON dag_monitor_requests(dag_run_id)
                """)
                
                conn.commit()
                cursor.close()
                conn.close()
                
                logger.info("Database initialized successfully!")
                return
                
            except psycopg2.OperationalError as e:
                logger.warning(f"Database connection failed (attempt {attempt}/{max_retries}): {e}")
                if attempt < max_retries:
                    logger.info(f"Retrying in {retry_delay} seconds...")
                    time.sleep(retry_delay)
                else:
                    logger.error("Failed to connect to database after maximum retries")
                    raise
    
    def insert_dag_request(self, event):
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            
            data = event.get('data', {})
            
            cursor.execute("""
                INSERT INTO dag_monitor_requests 
                (workflow_id, task_id, dag_id, dag_run_id, jobid, execution_id, 
                 metadata_key, minio_output_bucket, minio_output_key, event_type, 
                 stats_url, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                event.get('workflowId'),
                event.get('taskId'),
                data.get('dag_id'),
                data.get('dag_run_id'),
                data.get('jobid'),
                data.get('execution_id'),
                event.get('metadata_key'),
                event.get('minio_output_bucket'),
                event.get('minio_output_key'),
                event.get('event_type'),
                data.get('stats_url'),
                'pending'
            ))
            
            request_id = cursor.fetchone()[0]
            conn.commit()
            cursor.close()
            conn.close()
            
            logger.info(f"Inserted DAG monitoring request with ID: {request_id}")
            logger.info(f"Workflow: {event.get('workflowId')}")
            logger.info(f"DAG ID: {data.get('dag_id')}")
            logger.info(f"DAG Run ID: {data.get('dag_run_id')}")
            
            return request_id
            
        except Exception as e:
            logger.error(f"Error inserting DAG request: {e}", exc_info=True)
            return None
    
    def get_pending_requests(self):
        
        try:
            conn = self.get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            
            cursor.execute("""
                SELECT * FROM dag_monitor_requests 
                WHERE status = 'pending'
                ORDER BY created_at ASC
            """)
            
            requests = cursor.fetchall()
            cursor.close()
            conn.close()
            
            return requests
            
        except Exception as e:
            logger.error(f"Error fetching pending requests: {e}", exc_info=True)
            return []

    def get_active_requests(self):
        try:
            conn = self.get_connection()
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            cursor.execute("""
                SELECT *
                FROM dag_monitor_requests
                WHERE status IN ('pending', 'running')
                ORDER BY updated_at ASC
            """)

            requests = cursor.fetchall()
            cursor.close()
            conn.close()

            return requests

        except Exception as e:
            logger.error(f"Error fetching active requests: {e}", exc_info=True)
            return []

    def update_request_status(self, request_id, status, error_message=None):
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            
            update_fields = ["status = %s", "updated_at = CURRENT_TIMESTAMP"]
            params = [status]
            
            if status == 'monitoring':
                update_fields.append("started_monitoring_at = CURRENT_TIMESTAMP")
            elif status in ['completed', 'failed']:
                update_fields.append("completed_at = CURRENT_TIMESTAMP")
            
            if error_message:
                update_fields.append("error_message = %s")
                params.append(error_message)
            
            params.append(request_id)
            
            query = f"""
                UPDATE dag_monitor_requests 
                SET {', '.join(update_fields)}
                WHERE id = %s
            """
            
            cursor.execute(query, params)
            conn.commit()
            cursor.close()
            conn.close()
            
            logger.info(f"Updated request {request_id} status to: {status}")
            
        except Exception as e:
            logger.error(f"Error updating request status: {e}", exc_info=True)


class DAGMonitorWorker:
    """Monitors Airflow DAG runs and publishes completion events."""

    def __init__(self):
        self.kafka_producer = kafka_producer
        self.s3_manager = s3_manager
        self.minio_manager = minio_manager
        self.db_manager = DatabaseManager()
        self.stop_event = threading.Event()
    
    def check_dag_status(self, dag_id, dag_run_id):
        
        try:
            if not MWAA_SESSION_TOKEN:
                logger.error("MWAA Session Token is missing")
                return None, "Session token not configured", None
            
            api_url = f"{MWAA_ENDPOINT}/api/v1/dags/{dag_id}/dagRuns/{dag_run_id}"
            response = requests.get(
                api_url,
                cookies={"session": MWAA_SESSION_TOKEN},
                headers={"Content-Type": "application/json"},
                timeout=30
            )

            if response.status_code == 200:
                dag_run_data = response.json()
                state = dag_run_data.get('state', 'unknown')
                return state, None, dag_run_data
            
            elif response.status_code == 404:
                return None, f"DAG run not found: {dag_run_id}", None
            
            else:
                return None, f"API Error {response.status_code}: {response.text}", None
        
        except requests.exceptions.RequestException as e: 
            return None, f"Network Error: {str(e)}", None
        except Exception as e: 
            return None, f"Error checking DAG status: {str(e)}", None
    

    def check_and_finalize_dag(self, request):
        request_id = request['id']
        dag_id = request['dag_id']
        dag_run_id = request['dag_run_id']
        if request['status'] == 'completed':
            return

        current_status=request['status']

        state, error, response_data = self.check_dag_status(dag_id, dag_run_id)

        if error:
            logger.warning(f"DAG check failed for {dag_run_id}: {error}")
            return

        if state in ['queued', 'running', 'up_for_retry', 'up_for_reschedule']:
            self.db_manager.update_request_status(request_id, 'running')
            return

        if state == 'success' and current_status!="completed":
            try:
                self.download_dag_outputs(request, response_data)
            except Exception as e:
                logger.error(f"Output handling failed: {e}")

            self.db_manager.update_request_status(request_id, 'completed')
            self.publish_completion_event(request, 'success', response_data=response_data)
            return

        if state in ['failed', 'skipped', 'upstream_failed']:
            error_msg = f"DAG ended with state {state}"
            self.db_manager.update_request_status(request_id, 'failed', error_msg)
            self.publish_completion_event(request, 'failed', error_msg)

    
    def download_dag_outputs(self, request, response_data):
        """Download stats and output files from S3 to MinIO"""
        workflow_id = request['workflow_id']
        metadata_key = request['metadata_key']
        minio_output_bucket = request['minio_output_bucket']
        minio_output_key = request['minio_output_key']
        
        # Download stats from S3 and upload to MinIO
        if response_data:
            stats_url = response_data.get('conf', {}).get('stats_url', '')
            if stats_url:
                logger.info(f"Stats URL fetched: {stats_url}")
                stats_url_parts = stats_url.replace("s3://", "").split("/", 1)
                
                if len(stats_url_parts) == 2:
                    stats_bucket = stats_url_parts[0]
                    stats_key = stats_url_parts[1]
                    stats_input_key = stats_key.split("/")[-1]
                    
                    logger.info(f"Downloading stats from S3: {stats_bucket}/{stats_key}")
                    
                    with tempfile.NamedTemporaryFile(delete=False, suffix=".jsonl") as stats_file:
                        try:
                            s3_manager.download_file(stats_key, stats_file.name)
                            minio_manager.upload_file(stats_file.name, bucket=minio_output_bucket, 
                                                     object_key=stats_input_key)
                            
                            logger.info(f"Stats file uploaded to MinIO: {minio_output_bucket}/{stats_input_key}")
                        except Exception as e:
                            logger.error(f"Error processing stats file: {e}")
                            raise
        
        # Download output file from S3 and upload to MinIO
        if metadata_key:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".json") as temp_file:
                s3_manager.download_file(metadata_key, temp_file.name)
            
            with open(temp_file.name, 'r') as f:
                metadata_data = json.load(f)
                output_uri = metadata_data.get('service', {}).get('output', {}).get('uri')
            
            if output_uri:
                output_key = output_uri.split("/", 3)[-1]
                with tempfile.NamedTemporaryFile(delete=False, suffix=".out") as output_file:
                    s3_manager.download_file(output_key, output_file.name)
                    logger.info(f"Output file downloaded from S3, uploading to MinIO...")
                    minio_manager.upload_file(output_file.name, minio_output_bucket, minio_output_key)
                    logger.info(f"Output file uploaded to MinIO: {minio_output_bucket}/{minio_output_key}")
            else:
                logger.warning(f"Output URI not found in metadata")

    def publish_completion_event(self, request, status, error_message=None,response_data=None):
        """Publishes DAG completion event to Kafka"""
        try:
            workflow_id = request['workflow_id']
            task_id = request['task_id']
            dag_id = request['dag_id']
            jobid = request['jobid']
            event_type = request['event_type']
            minio_output_bucket = request['minio_output_bucket']
            minio_output_key=request['minio_output_key']
            if response_data:
                stats_url = response_data.get('conf', {}).get('stats_url', '')
                stats_url_parts = stats_url.replace("s3://", "").split("/", 1)
                
                if len(stats_url_parts) == 2:
                    stats_bucket = stats_url_parts[0]
                    stats_key = stats_url_parts[1]
                    stats_input_key = stats_key.split("/")[-1]

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
                    "stats_url": f"minio://{minio_output_bucket}/{stats_input_key}" if status == "success" else None
                }
            }

            if request.get('metadata_key'):
                completion_event["data"]["metadata_url"] = request['metadata_key']
            
            if status == "failed" and error_message:
                completion_event["data"]["error"] = error_message

            self.kafka_producer.send("conductor-events", completion_event)
            self.kafka_producer.flush()
            
            logger.info(f"Published DAG completion event to conductor-events")
            logger.info(f"Workflow: {workflow_id}")
            logger.info(f"Event Type: {event_type}")
            logger.info(f"DAG: {dag_id}, Job: {jobid}, Status: {status}")
            
        except Exception as e:
            logger.error(f"Error publishing DAG completion event: {e}", exc_info=True)
    
    def kafka_consumer_thread(self):
        """Thread 1: Consume Kafka events and insert into database"""
        logger.info("Thread 1: Kafka Consumer started")
        
        consumer = KafkaConsumer(
            DAG_MONITOR_TOPIC,
            bootstrap_servers=KAFKA_BOOTSTRAP,
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            group_id=f"{SERVICE_NAME}-group",
            auto_offset_reset='latest'
        )
        
        logger.info(f"Consuming DAG monitor events from '{DAG_MONITOR_TOPIC}' topic...")
        
        for message in consumer:
            if self.stop_event.is_set():
                break
            
            try:
                event = message.value
                
                if isinstance(event, str):
                    try:
                        event = json.loads(event)
                    except json.JSONDecodeError:
                        logger.error(f"Failed to parse JSON string: {event}")
                        continue
                
                # Insert into database
                request_id = self.db_manager.insert_dag_request(event)
                if request_id:
                    logger.info(f"DAG monitoring request queued in database (ID: {request_id})")
                
            except Exception as e:
                logger.error(f"Error processing Kafka message: {e}", exc_info=True)
    

    def database_polling_thread(self):
        logger.info("Thread 2: Non-blocking DB Poller started")

        time.sleep(10)

        while not self.stop_event.is_set():
            try:
                active_requests = self.db_manager.get_active_requests()

                if active_requests:
                    logger.info(f"Polling {len(active_requests)} DAG(s)")

                for request in active_requests:
                    self.check_and_finalize_dag(request)

            except Exception as e:
                logger.error("Polling loop error", exc_info=True)

            time.sleep(DB_POLL_INTERVAL)

    
    def start(self):
        """Start both threads"""
        logger.info("="*60)
        logger.info("Starting DAG Monitor Worker with Two-Thread Pattern")
        logger.info("="*60)
        
        # Start Thread 1: Kafka Consumer
        kafka_thread = threading.Thread(
            target=self.kafka_consumer_thread,
            name="KafkaConsumerThread",
            daemon=True
        )
        kafka_thread.start()
        logger.info("Thread 1 (Kafka Consumer) started")
        
        # Start Thread 2: Database Polling
        polling_thread = threading.Thread(
            target=self.database_polling_thread,
            name="DatabasePollingThread",
            daemon=True
        )
        polling_thread.start()
        logger.info("Thread 2 (Database Polling) started")
        
        logger.info("="*60)
        logger.info("Both threads are running")
        logger.info("="*60)
        
        # Keep main thread alive
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Shutting down...")
            self.stop_event.set()


def main():
    """Start the Service"""
    logger.info(f"Starting DAG Monitor Worker")
    logger.info(f"Kafka Bootstrap: {KAFKA_BOOTSTRAP}")
    logger.info(f"Database: {Config.DB_HOST}:{Config.DB_PORT}/{Config.DB_NAME}")
    
    service = DAGMonitorWorker()
    service.start()


if __name__ == "__main__":
    main()
