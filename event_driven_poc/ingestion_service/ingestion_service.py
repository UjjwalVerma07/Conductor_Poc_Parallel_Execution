from asyncio import tasks
import os
import uuid
from datetime import datetime
from typing import Dict, Any, Optional
from s3_utils import S3Manager
from minio_utils import MinIOManager
from config import Config


class IngestionService:

    
    def __init__(self):
        self.s3_manager = S3Manager()
        self.minio_manager = MinIOManager()
    
    def generate_run_id(self, prefix: Optional[str] = None) -> str:

        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        unique_id = str(uuid.uuid4())[:8]
        
        if prefix:
            return f"{prefix}-{timestamp}-{unique_id}"
        return f"run-{timestamp}-{unique_id}"
    

    def ingest_file_and_update_json(
        self,
        input_uri: str,
        source_json_s3_key: str,
        run_id: Optional[str] = None,
        workflow_id: Optional[str] = None
    ) -> Dict[str, Any]:
        
        print("Testing Whether we are getting the Workflow ID or not : ",workflow_id)
        if not run_id:
            run_id = self.generate_run_id()
       
       
        input_filename = os.path.basename(input_uri)
        s3_input_key = f"{Config.S3_PREFIX}/runs/{workflow_id}/{input_filename}"
        
        s3_output_key = f"{Config.S3_PREFIX}/runs/{workflow_id}/{input_filename.replace('.in', '.out')}"
        
       
        json_basename = os.path.basename(source_json_s3_key)  
        report_base = json_basename.split('.')[0] if '.' in json_basename else run_id
        s3_report_key = f"{Config.S3_PREFIX}/runs/{workflow_id}/report/{report_base}.counts.txt"
        
        s3_json_key = f"{Config.S3_PREFIX}/{json_basename}"
        

        if input_uri.startswith("minio://"):
            local_temp_dir = os.path.join(Config.LOCAL_TEMP_DIR, run_id)
            os.makedirs(local_temp_dir, exist_ok=True)
            local_file_path = os.path.join(local_temp_dir, input_filename)
        

            print(f"Downloading from MinIO: {input_uri}")
            self.minio_manager.download_file(input_uri, local_file_path)
      
            print(f"Uploading to S3: s3://{Config.S3_BUCKET}/{s3_input_key}")
            s3_input_uri = self.s3_manager.upload_file(local_file_path, s3_input_key)

        
            try:
                os.remove(local_file_path)
                os.rmdir(local_temp_dir)
            except Exception as e:
                print(f"Warning: Could not Clean up temp files: {e}")
        
        else:
      
            print(f"Skipping download/upload. Using existing S3 URI: {input_uri}")
            s3_input_uri=input_uri

    
        print(f"Fetching JSON from S3: {source_json_s3_key}")
        s3_output_uri = f"s3://{Config.S3_BUCKET}/{s3_output_key}"
        s3_report_uri = f"s3://{Config.S3_BUCKET}/{s3_report_key}"
        print(f"Input_URI: {s3_input_uri}, Output_URI: {s3_output_uri}, Report_URI: {s3_report_uri}")
    
        updated_json_uri = self.s3_manager.fetch_and_update_json(
            source_s3_key=source_json_s3_key,
            input_uri=s3_input_uri,
            output_uri=s3_output_uri,
            target_s3_key=s3_json_key,
            report_uri=s3_report_uri,
            workflow_id=workflow_id
        )
        
        return {
            "run_id": run_id,
            "s3_input_uri": s3_input_uri,
            "s3_output_uri": s3_output_uri,
            "s3_report_uri": s3_report_uri,
            "updated_json_uri": updated_json_uri,
            "updated_json_s3_key": s3_json_key
        }
    


    import os, uuid

    def execute_service_chain(self, workflow_json: Dict[str, Any], minio_input_uri: str, workflow_id: Optional[str] = None):
        service_results={}
        json_mapping={
            #Mapping of task name to json file in s3
            'trigger_airflow_dag':'conductor-poc/1000861509.WBNameParse.json',
            'trigger_email_hygiene':'conductor-poc/1000876411WBEmail_Hygiene.json',
            'dp_email_hygiene':'conductor-poc/dp_email_hygiene.json',
            'dp_name_parse':'conductor-poc/dp_name_parse.json'
        }
        current_input_uri=minio_input_uri

        for task in workflow_json.get("tasks",[]):
            task_name=task.get("name") or task.get("taskReferenceName")

            if task_name not in json_mapping:
                print(f"Skipping Task: {task_name}")
                continue

            print(f"Executing ingestion pipeline for {task_name}...")
            output=self.ingest_file_and_update_json(
                input_uri=current_input_uri,
                source_json_s3_key=json_mapping[task_name],
                workflow_id=workflow_id
            )

            service_results[task_name]=output
            current_input_uri=output['s3_output_uri']
        
        return service_results,current_input_uri





    
    def update_workflow_template(
        self,
        workflow_json: dict,
        service_results: Dict[str, Dict[str, Any]]
    ) -> dict:
       
        for task in workflow_json.get("tasks", []):
            task_name = task.get("name") or task.get("taskReferenceName")
            if task_name in service_results:
                if task_name=="trigger_airflow_dag":
                    metadata_url = service_results[task_name]["updated_json_uri"]
                    task.setdefault("inputParameters", {}).setdefault("kafka_request", {})["metadataUrl"] = metadata_url
                    print(f"Updated task '{task_name}' with metadata URL: {metadata_url}")

        return workflow_json




# "minio://raw-data/1000861642.in"