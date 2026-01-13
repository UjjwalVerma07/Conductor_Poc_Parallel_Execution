# Ingestion Service

Service to handle file ingestion from MinIO to S3 and prepare dynamic workflow definitions for Conductor.

## Features

- Download files from MinIO
- Upload files to AWS S3
- Update service JSON templates with S3 URIs
- Generate dynamic workflow definitions
- Register and trigger Conductor workflows

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Configure environment variables (copy `.env.example` to `.env` and update):
```bash
cp .env.example .env
```

3. Run the service:
```bash
python main.py
```

Or with uvicorn:
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## API Endpoints

- `GET /` - Service info
- `GET /health` - Health check
- `POST /ingest` - Ingest file and prepare workflow (to be implemented)

## Environment Variables

See `.env.example` for all configuration options.






