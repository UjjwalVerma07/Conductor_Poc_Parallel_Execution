"""
S3 utility functions for downloading, updating, and uploading JSON files
"""
import boto3
import json
import os
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError
from config import Config


class S3Manager:    
    def __init__(self):

        Config.validate()
        
        session_kwargs = {
            'aws_access_key_id': Config.AWS_ACCESS_KEY_ID,
            'aws_secret_access_key': Config.AWS_SECRET_ACCESS_KEY,
            'region_name': Config.AWS_REGION
        }
        
        if Config.AWS_SESSION_TOKEN:
            session_kwargs['aws_session_token'] = Config.AWS_SESSION_TOKEN
     
        self.s3_client = boto3.client('s3', **session_kwargs)
        self.bucket = Config.S3_BUCKET
        self.base_prefix = Config.S3_PREFIX
        
 
        self._validate_bucket_restrictions()
    
    def _validate_bucket_restrictions(self):
        if self.bucket != Config.ALLOWED_S3_BUCKET:
            raise ValueError(
                f"SECURITY: Only company-allotted bucket '{Config.ALLOWED_S3_BUCKET}' is allowed. "
                f"Attempted to use: '{self.bucket}'"
            )
        if self.base_prefix != Config.ALLOWED_S3_PREFIX:
            raise ValueError(
                f"SECURITY: Only prefix '{Config.ALLOWED_S3_PREFIX}' is allowed. "
                f"Attempted to use: '{self.base_prefix}'"
            )
    
    def _validate_s3_key(self, s3_key: str):
        if not s3_key.startswith(f"{self.base_prefix}/"):
            raise ValueError(
                f"SECURITY: All S3 keys must start with '{self.base_prefix}/'. "
                f"Invalid key: '{s3_key}'"
            )
    
    def download_json(self, s3_key: str) -> Dict[str, Any]:
        self._validate_s3_key(s3_key)
        
        try:
            response = self.s3_client.get_object(Bucket=self.bucket, Key=s3_key)
            content = response['Body'].read().decode('utf-8')
            return json.loads(content)
        except ClientError as e:
            raise Exception(f"Failed to download {s3_key} from S3: {str(e)}")
        except json.JSONDecodeError as e:
            raise Exception(f"Invalid JSON in {s3_key}: {str(e)}")
    
    def upload_json(self, data: Dict[str, Any], s3_key: str) -> str:
    
        self._validate_s3_key(s3_key)
        
        try:
            json_str = json.dumps(data, indent=2)
            self.s3_client.put_object(
                Bucket=self.bucket,
                Key=s3_key,
                Body=json_str.encode('utf-8'),
                ContentType='application/json'
            )
            return f"s3://{self.bucket}/{s3_key}"
        except ClientError as e:
            raise Exception(f"Failed to upload {s3_key} to S3: {str(e)}")

    
    def upload_file(self, local_path: str, s3_key: str) -> str:

        self._validate_s3_key(s3_key)
        
        try:
            self.s3_client.upload_file(local_path, self.bucket, s3_key)
            return f"s3://{self.bucket}/{s3_key}"
        except ClientError as e:
            raise Exception(f"Failed to upload file {local_path} to S3: {str(e)}")
    
    def download_file(self, s3_key: str, local_path: str) -> str:
    
        self._validate_s3_key(s3_key)
        
        try:
         
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            
            self.s3_client.download_file(self.bucket, s3_key, local_path)
            return local_path
        except ClientError as e:
            raise Exception(f"Failed to download {s3_key} from S3: {str(e)}")
    
    def update_json_uris(
        self, 
        json_data: Dict[str, Any], 
        input_uri: str, 
        output_uri: str,
        report_uri: Optional[str] = None,
        workflow_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """This is the JSON file that is updated with the input, output, and report URIs that are stored in the AWS S3 Bucket."""
        updated_data = json.loads(json.dumps(json_data))  # Deep copy
       
        if 'service' in updated_data and 'input' in updated_data['service']:
            updated_data['service']['input']['uri'] = input_uri
       
        if 'service' in updated_data and 'output' in updated_data['service']:
            updated_data['service']['output']['uri'] = output_uri
        

        if report_uri and 'service' in updated_data and 'report' in updated_data['service']:
            updated_data['service']['report']['uri'] = report_uri
        

        if workflow_id and 'metadata' in updated_data:
            if 'environment' in updated_data['metadata']:
                for env_var in updated_data['metadata']['environment']:
                    if env_var.get('name') == 'WORKFLOW_ID':
                        env_var['value'] = workflow_id
        
        return updated_data
    
    def fetch_and_update_json(
        self,
        source_s3_key: str,
        input_uri: str,
        output_uri: str,
        target_s3_key: str,
        report_uri: Optional[str] = None,
        workflow_id: Optional[str] = None
    ) -> str:

        json_data = self.download_json(source_s3_key)

        updated_json = self.update_json_uris(
            json_data, 
            input_uri, 
            output_uri,
            report_uri,
            workflow_id
        )
        
    
        return self.upload_json(updated_json, target_s3_key)

