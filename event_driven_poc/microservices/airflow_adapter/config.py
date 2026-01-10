
import os
from dotenv import load_dotenv
import pathlib

load_dotenv()


class Config:

    MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
    MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
    MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
    MINIO_USE_SSL = os.getenv("MINIO_USE_SSL", "false").lower() == "true"

    
    aws_config_dir = pathlib.Path.home() / ".aws"
    aws_creds_file = aws_config_dir / "credentials"
    aws_config_file = aws_config_dir / "config"

    if aws_creds_file.exists() or aws_config_file.exists():
        AWS_ACCESS_KEY_ID = None 
        AWS_SECRET_ACCESS_KEY = None
        AWS_SESSION_TOKEN = None
    else:
        
        AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
        AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
        AWS_SESSION_TOKEN = os.getenv("AWS_SESSION_TOKEN")

    AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

    ALLOWED_S3_BUCKET = "958825666686-dpservices-testing-data"
    ALLOWED_S3_PREFIX = "conductor-poc"

    S3_BUCKET = os.getenv("S3_BUCKET", ALLOWED_S3_BUCKET)
    S3_PREFIX = os.getenv("S3_PREFIX", ALLOWED_S3_PREFIX)

    CONDUCTOR_SERVER_URL = os.getenv("CONDUCTOR_SERVER_URL", "http://conductor-server:8080/api")

    LOCAL_TEMP_DIR = os.getenv("LOCAL_TEMP_DIR", "/tmp/ingestion_service")

    WORKFLOW_TEMPLATES_DIR = os.getenv("WORKFLOW_TEMPLATES_DIR", "./templates")
    SERVICE_TEMPLATES_DIR = os.getenv("SERVICE_TEMPLATES_DIR", "./templates/services")

    @classmethod
    def validate(cls):
        
        errors = []

        aws_creds_available = (
            (cls.AWS_ACCESS_KEY_ID and cls.AWS_SECRET_ACCESS_KEY) or
            (cls.aws_creds_file.exists() or cls.aws_config_file.exists())
        )

        if not aws_creds_available:
            errors.append(
                "AWS credentials are required. "
                "Use SSO-mounted ~/.aws or set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY"
            )

        if not cls.S3_BUCKET:
            errors.append("S3_BUCKET is required")

        if cls.S3_BUCKET != cls.ALLOWED_S3_BUCKET:
            errors.append(
                f"S3_BUCKET must be '{cls.ALLOWED_S3_BUCKET}' (company-allotted bucket). "
                f"Current value: '{cls.S3_BUCKET}'"
            )

        if cls.S3_PREFIX != cls.ALLOWED_S3_PREFIX:
            errors.append(
                f"S3_PREFIX must be '{cls.ALLOWED_S3_PREFIX}'. "
                f"Current value: '{cls.S3_PREFIX}'"
            )

        if errors:
            raise ValueError(f"Configuration errors: {', '.join(errors)}")

        return True
