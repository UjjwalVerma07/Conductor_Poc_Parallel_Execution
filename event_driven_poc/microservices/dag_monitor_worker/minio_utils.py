
from minio import Minio
from minio.error import S3Error
from config import Config
import os
from typing import Optional, Tuple


class MinIOManager:
    def __init__(self):
        self.client = Minio(
            Config.MINIO_ENDPOINT,
            access_key=Config.MINIO_ACCESS_KEY,
            secret_key=Config.MINIO_SECRET_KEY,
            secure=Config.MINIO_USE_SSL
        )
    
    def parse_minio_uri(self, uri: str) -> Tuple[str, str]:
  
        if uri.startswith("minio://"):
            uri = uri[8:]
        
      
        parts = uri.split("/", 1)
        if len(parts) != 2:
            raise ValueError(f"Invalid MinIO URI format: {uri}. Expected format: minio://bucket/path/to/file")
        
        bucket = parts[0]
        object_key = parts[1]
        
        return bucket, object_key

    def download_file(self, minio_uri: str, local_path: str) -> str:
        try:
            bucket, object_key = self.parse_minio_uri(minio_uri)
           
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            
     
            self.client.fget_object(bucket, object_key, local_path)
            
            return local_path
        except S3Error as e:
            raise Exception(f"Failed to download {minio_uri} from MinIO: {str(e)}")
        except Exception as e:
            raise Exception(f"Error downloading from MinIO: {str(e)}")
    
    def file_exists(self, minio_uri: str) -> bool:
        try:
            bucket, object_key = self.parse_minio_uri(minio_uri)
            self.client.stat_object(bucket, object_key)
            return True
        except S3Error:
            return False
        except Exception:
            return False
    
    def upload_file(self,local_path,bucket,object_key):
        self.client.fput_object(bucket,object_key,local_path)
        return f"minio://{bucket}/{object_key}"

