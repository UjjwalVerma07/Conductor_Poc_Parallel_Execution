# Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Prerequisites Check

```bash
# Verify Docker is installed
docker --version
docker-compose --version

# Verify AWS credentials (if using S3)
aws sts get-caller-identity
```

---

## Step 1: Configure Environment (2 minutes)

```bash
cd event_driven_poc

# Create .env file
cat > .env << 'EOF'
# AWS Configuration
AWS_ACCESS_KEY_ID=your_key_here
AWS_SECRET_ACCESS_KEY=your_secret_here
AWS_SESSION_TOKEN=your_token_here
AWS_DEFAULT_REGION=us-east-1

# S3 Configuration
S3_BUCKET=958825666686-dpservices-testing-data
S3_PREFIX=conductor-poc

# MWAA Configuration (Optional - for Airflow integration)
MWAA_ENDPOINT=https://your-mwaa-endpoint.airflow.amazonaws.com:443
MWAA_SESSION_TOKEN=your_mwaa_session_token

# Conductor Configuration
CONDUCTOR_URL=http://conductor-server:8080

# Kafka Configuration
KAFKA_BOOTSTRAP=kafka:9092

# MinIO Configuration
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
EOF
```

---

## Step 2: Start All Services (1 minute)

```bash
# Start infrastructure
docker-compose up -d

# Wait for services to initialize
echo "Waiting 30 seconds for services to start..."
sleep 30

# Verify all services are running
docker-compose ps
```

**Expected Output**: All services should show "Up" or "healthy" status.

---

## Step 3: Verify Services (1 minute)

```bash
# Check Conductor
curl http://localhost:8080/health
# Expected: {"healthy":true}

# Check Ingestion Service
curl http://localhost:8000/health
# Expected: {"status":"ok"}

# Check MinIO (open in browser)
open http://localhost:9001
# Login: minioadmin / minioadmin

# Check Conductor UI (open in browser)
open http://localhost:8080
```

---

## Step 4: Start React Workflow Designer (1 minute)

```bash
# In a new terminal
cd ../react_workflow_app

# Install dependencies (first time only)
npm install

# Start development server
npm run dev
```

Open http://localhost:5173 in your browser.

---

## Step 5: Create Your First Workflow

### Option A: Use a Template (Easiest)

1. Open React app at http://localhost:5173
2. Click **"Direct Integration Pipeline"** template in the left sidebar
3. A complete 4-stage workflow appears on the canvas
4. Click **"Deploy"** button
5. Enter deployment URL: `http://localhost:8000/workflow/deploy`
6. Click **"Deploy"**
7. Monitor execution in Conductor UI: http://localhost:8080

### Option B: Design from Scratch

1. Open React app at http://localhost:5173
2. Drag **"Email Hygiene Node"** from palette onto canvas
3. Click the **edit icon** on the node
4. Configure:
   - Task Name: `dp_email_hygiene`
   - Topic: `email-hygiene-requests`
   - Enable Sink: ✅
   - Sink Address: `conductor:email_hygiene_completed`
5. Click **"View JSON"** to preview
6. Click **"Deploy"** to execute

---

## Step 6: Monitor Execution

### Conductor UI (Primary)
```bash
open http://localhost:8080
```

- Navigate to **"Workflow Defs"** → View registered workflows
- Click **"Executions"** → See running workflows
- Click on a workflow ID → View detailed task execution

### Check Logs (Secondary)
```bash
# View all logs
docker-compose logs -f

# View specific service
docker-compose logs -f event-router
docker-compose logs -f airflow-adapter
docker-compose logs -f dag-monitor-worker
```

---

## 🎯 Next Steps

### Test Email Hygiene Workflow

```bash
# Upload test data to MinIO
docker-compose exec minio mc mb myminio/raw-data
docker-compose exec minio mc cp /path/to/test.in myminio/raw-data/
```

### Test Name Parse Workflow

```bash
# Trigger via Conductor API
curl -X POST http://localhost:8080/api/workflow/name_parse_workflow \
  -H "Content-Type: application/json" \
  -d '{}'
```

### View Kafka Topics

```bash
# List all topics
docker-compose exec kafka kafka-topics --list --bootstrap-server localhost:9092

# Consume conductor-events
docker-compose exec kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic conductor-events \
  --from-beginning
```

---

## 🛑 Troubleshooting

### Services Won't Start

```bash
# Check for port conflicts
lsof -i :8080  # Conductor
lsof -i :9092  # Kafka
lsof -i :8000  # Ingestion Service

# Rebuild and restart
docker-compose down -v
docker-compose up -d --build
```

### Workflow Stuck

```bash
# Check event-router is processing events
docker-compose logs -f event-router

# Check microservice logs
docker-compose logs -f email-hygiene
docker-compose logs -f airflow-adapter

# Check Kafka topics
docker-compose exec kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic conductor-events \
  --from-beginning
```

### MinIO Access Issues

```bash
# Reset MinIO
docker-compose restart minio

# Create buckets manually
docker-compose exec minio mc mb myminio/raw-data
docker-compose exec minio mc mb myminio/email-hygiene-output
docker-compose exec minio mc mb myminio/name-parse-output
```

---

## 📊 Sample Workflows

### 1. Simple Email Validation
```json
{
  "name": "simple_email_validation",
  "version": 1,
  "tasks": [
    {
      "name": "validate_email",
      "taskReferenceName": "validate_email",
      "type": "KAFKA_PUBLISH",
      "inputParameters": {
        "kafka_request": {
          "topic": "email-validation-requests",
          "bootStrapServers": "kafka:9092",
          "key": "validation-${workflow.workflowId}",
          "value": {
            "workflowId": "${workflow.workflowId}",
            "taskId": "email_validation_task",
            "eventType": "email_validation_request",
            "data": {
              "email": "test@example.com"
            }
          }
        }
      }
    },
    {
      "name": "wait_for_validation",
      "taskReferenceName": "wait_for_validation",
      "type": "EVENT",
      "sink": "conductor:email_validation_completed"
    }
  ]
}
```

### 2. Parallel Validation
```json
{
  "name": "parallel_validation",
  "version": 1,
  "tasks": [
    {
      "name": "fork_validation",
      "taskReferenceName": "fork_validation",
      "type": "FORK_JOIN",
      "forkTasks": [
        [
          {
            "name": "validate_email",
            "taskReferenceName": "validate_email",
            "type": "KAFKA_PUBLISH",
            "inputParameters": {
              "kafka_request": {
                "topic": "email-validation-requests",
                "bootStrapServers": "kafka:9092"
              }
            }
          }
        ],
        [
          {
            "name": "validate_phone",
            "taskReferenceName": "validate_phone",
            "type": "KAFKA_PUBLISH",
            "inputParameters": {
              "kafka_request": {
                "topic": "phone-validation-requests",
                "bootStrapServers": "kafka:9092"
              }
            }
          }
        ]
      ]
    },
    {
      "name": "join_validation",
      "taskReferenceName": "join_validation",
      "type": "JOIN"
    }
  ]
}
```

---

## 🔄 Common Commands

### Docker Management
```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# Restart specific service
docker-compose restart event-router

# View logs
docker-compose logs -f [service-name]

# Rebuild service
docker-compose up -d --build [service-name]

# Remove all volumes (clean slate)
docker-compose down -v
```

### Kafka Management
```bash
# List topics
docker-compose exec kafka kafka-topics --list --bootstrap-server localhost:9092

# Create topic
docker-compose exec kafka kafka-topics --create --topic my-topic \
  --bootstrap-server localhost:9092 --partitions 1 --replication-factor 1

# Consume messages
docker-compose exec kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 --topic conductor-events --from-beginning

# Produce test message
docker-compose exec kafka kafka-console-producer \
  --bootstrap-server localhost:9092 --topic test-topic
```

### MinIO Management
```bash
# List buckets
docker-compose exec minio mc ls myminio/

# Create bucket
docker-compose exec minio mc mb myminio/my-bucket

# Upload file
docker-compose exec minio mc cp /path/to/file myminio/bucket/

# Download file
docker-compose exec minio mc cp myminio/bucket/file /path/to/destination
```

---

## 📞 Need Help?

- **Check Logs**: `docker-compose logs -f [service-name]`
- **Conductor UI**: http://localhost:8080
- **MinIO Console**: http://localhost:9001
- **React App**: http://localhost:5173
- **Ingestion Service**: http://localhost:8000

---

**Ready to build event-driven workflows? Start with the React app at http://localhost:5173!**
