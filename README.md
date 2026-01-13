# Conductor Kafka POC - Event-Driven Orchestrator Platform

## 📋 Table of Contents
- [Project Overview](#project-overview)
- [Objective](#objective)
- [Architecture](#architecture)
- [Components](#components)
- [Technology Stack](#technology-stack)
- [Data Flow](#data-flow)
- [Setup & Installation](#setup--installation)
- [Usage](#usage)
- [Key Features](#key-features)
- [API Endpoints](#api-endpoints)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Project Overview

This project is a **Proof of Concept (POC)** for an **event-driven, microservices-based data processing platform** using **Netflix Conductor** for orchestration and **Apache Kafka** for asynchronous communication. It demonstrates how to build a scalable, decoupled architecture for processing workflows involving multiple stages like name parsing, email hygiene, data validation, and enrichment.

The system integrates with:
- **AWS S3** and **MinIO** for object storage
- **Apache Airflow (MWAA)** for complex data processing tasks
- **Kafka** for event streaming and microservice communication
- **Conductor** for workflow orchestration
- **ReactFlow** for visual workflow design

---

## 🎯 Objective

### Primary Goals

1. **Demonstrate Event-Driven Architecture**
   - Replace synchronous API calls with asynchronous Kafka-based communication
   - Implement true event-driven patterns using Conductor's sink mechanism
   - Enable loosely coupled, scalable microservices

2. **Workflow Orchestration at Scale**
   - Orchestrate complex multi-stage data processing workflows
   - Support dynamic workflow generation and deployment
   - Handle parallel and sequential processing patterns
   - Monitor and retry failed tasks automatically

3. **Integration with Legacy Systems**
   - Bridge microservices with existing Airflow DAGs
   - Process data using DPServices (Data Processing Services)
   - Maintain compatibility with existing S3-based data flows

4. **Developer Experience**
   - Provide a visual workflow designer for non-technical users
   - Generate valid Conductor workflows without manual JSON writing
   - Enable rapid prototyping and testing of data pipelines

5. **Production-Ready Patterns**
   - Implement retry mechanisms and error handling
   - Support real-time monitoring and stats collection
   - Enable workflow failure recovery and replay
   - Provide observability through WebSocket-based updates

---

## 🏗️ Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          React Workflow Designer                        │
│                    (Visual workflow creation & deployment)              │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ HTTP POST
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Ingestion Service                              │
│  - Receives workflow definitions                                        │
│  - Converts XML to JSON for DPServices                                  │
│  - Manages S3 ↔ MinIO data transfer                                     │
│  - Deploys & triggers Conductor workflows                               │
│  - Monitors workflow execution (WebSocket updates)                      │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │   Conductor    │
                    │     Server     │◄─────────────┐
                    └────┬───────────┘              │
                         │                          │
                    (Kafka Events)                  │
                         │                          │
                         ▼                          │
              ┌──────────────────────┐              │
              │    Kafka Broker      │              │
              │  (Event Bus/Queue)   │              │
              └──────────┬───────────┘              │
                         │                          │
        ┌────────────────┼───────────────────┐      │
        │                │                   │      │
        ▼                ▼                   ▼      │
┌──────────────┐  ┌──────────────┐  ┌──────────────┐│
│ Event Router │  │ Microservices│  │   Workers    ││
│              │  │              │  │              ││
│ Routes       │  │ - Email      │  │ - DAG        ││
│ completion   │  │   Hygiene    │  │   Monitor    ││
│ events to    │  │ - Email      │  │   Worker     ││
│ Conductor    │  │   Validator  │  │              ││
│ EVENT tasks  │  │ - Phone      │  │ Monitors     ││
│              │  │   Validator  │  │ Airflow DAG  ││
│              │  │ - Enricher   │  │ execution    ││
│              │  │ - Airflow    │  │ & publishes  ││
│              │  │   Adapter    │  │ completion   ││
│              │  │ - Reverse    │  │ events       ││
│              │  │   Email      │  │              ││
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘│
       │                 │                 │        │
       │                 │                 │        │
       └─────────────────┴─────────────────┴────────┘
                         │
                         │ (Publishes completion events)
                         │
                         └───────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                          External Systems                               │
│                                                                         │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                 │
│  │   AWS S3     │   │    MinIO     │   │   Airflow    │                 │
│  │   Storage    │   │   Storage    │   │    (MWAA)    │                 │
│  └──────────────┘   └──────────────┘   └──────────────┘                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### Architecture Principles

1. **Event-Driven Communication**: All microservices communicate via Kafka topics, avoiding direct HTTP dependencies.
2. **Sink-Based Pattern**: Conductor's sink mechanism enables true async processing - microservices publish results directly to Conductor.
3. **Separation of Concerns**: Each microservice handles a single responsibility.
4. **Scalability**: Kafka consumers can be scaled independently based on load.
5. **Fault Tolerance**: Automatic retry mechanisms and workflow replay capabilities.

---

## 🧩 Components

### 1. **React Workflow Designer** (`react_workflow_app/`)

**Purpose**: Visual workflow designer for creating Conductor workflows without writing JSON.

**Key Features**:
- Drag-and-drop interface using ReactFlow
- Pre-built node types:
  - `KAFKA_PUBLISH`: Publish messages to Kafka topics
  - `EVENT`: Wait for async events (with sink support)
  - Custom nodes for Email Hygiene, Name Parse, etc.
- Real-time JSON preview
- Direct deployment to Conductor

**Technology**: React, ReactFlow, Material-UI, Vite

**Ports**: 
- Development: `5173`


---

### 2. **Ingestion Service** (`event_driven_poc/ingestion_service/`)

**Purpose**: Central service for workflow deployment, data ingestion, and monitoring.

**Key Responsibilities**:
1. **Workflow Deployment**:
   - Receives workflow definitions from React app
   - Extracts XML configurations for DPServices
   - Converts XML to JSON using `dpservices.bin`
   - Updates workflow with S3 URIs
   - Deploys to Conductor and triggers execution

2. **Data Management**:
   - Downloads files from MinIO
   - Uploads to AWS S3
   - Manages file transformations

3. **Real-Time Monitoring**:
   - Consumes workflow events from Kafka
   - Pushes stats and updates to UI via WebSocket
   - Monitors workflow failures and triggers retries

4. **Retry Management**:
   - Detects failed workflow tasks
   - Automatically constructs retry payloads
   - Identifies the correct restart point (handling EVENT task dependencies)

**Technology**: Python, FastAPI, Kafka, S3, MinIO

**Ports**: `8000`

**Key Endpoints**:
- `POST /workflow/deploy`: Deploy workflow from React app
- `WS /ws`: WebSocket for real-time updates
- `POST /retry-workflow`: Retry failed workflows

---

### 3. **Event Router** (`event_driven_poc/event_router/`)

**Purpose**: Routes completion events from microservices back to Conductor workflows.

**How It Works**:
1. Consumes events from `conductor-events` topic
2. Identifies completion events (e.g., `email_hygiene_completed`)
3. Extracts `workflowId` and `taskId` from event
4. Queries Conductor API to find matching EVENT task
5. Uses sink matching (e.g., `conductor:email_validation_completed`)
6. Completes the EVENT task with result data
7. Conductor continues workflow execution

**Technology**: Python, Kafka, Conductor API

**Key Features**:
- Smart event-to-task mapping
- Sink-based matching with fallback strategies
- Retry logic for transient failures
- Supports both exact and partial sink matching

---

### 4. **Microservices** (`event_driven_poc/microservices/`)

#### a. **Airflow Adapter** (`airflow_adapter/`)

**Purpose**: Triggers Airflow DAGs for complex data processing tasks (e.g., name parsing).

**Workflow**:
1. Consumes `airflow-trigger-requests` from Kafka
2. Generates unique Job ID (`jobid-session_id`)
3. Triggers Airflow DAG via MWAA API (or bash script)
4. Publishes monitoring event to `dag-monitor-queue`
5. Returns control immediately (async pattern)

**Configuration**:
- DAG ID: `nua-nameparse-process-stage-v02-00-06-tiny`
- Execution ID: `WBNameParse`
- MWAA Endpoint: AWS Managed Airflow

**Handles**:
- 409 Conflict (DAG run already exists) → Monitor existing run
- Retries with exponential backoff
- Stats URL generation for result tracking

---

#### b. **Email Hygiene Service** (`email_hygiene/`)

**Purpose**: Triggers Airflow DAGs for email hygiene processing.

**Workflow**:
1. Consumes `email-hygiene-requests` from Kafka
2. Triggers Airflow DAG: `nua-emailhygiene-process-stage-v01-01-04-tiny`
3. Publishes monitoring event to `dag-monitor-queue`

**Output**: Cleaned and validated email data in S3 and MinIO

---

#### c. **DAG Monitor Worker** (`dag_monitor_worker/`)

**Purpose**: Monitors Airflow DAG execution and publishes completion events.

**Workflow**:
1. Consumes monitoring events from `dag-monitor-queue`
2. Polls Airflow API every 10 seconds for DAG status
3. Checks for terminal states: `success`, `failed`, `skipped`
4. On success:
   - Downloads stats from S3
   - Uploads to MinIO
   - Downloads output files from S3
   - Uploads to MinIO
5. Publishes completion event to `conductor-events`
6. Conductor EVENT task receives completion and continues

**Key Features**:
- Thread pool for parallel monitoring (10 workers)
- Configurable poll interval and timeout
- Automatic S3 ↔ MinIO synchronization
- Detailed logging and error handling

---

#### d. **Email Validator** (`email_validator/`)

**Purpose**: Validates email addresses (structure, domain, MX records) dummy service to showcase the faults and retry mechanism.

**Input**: `email-validation-requests` topic  
**Output**: Validation results to `conductor-events`

---

#### e. **Phone Validator** (`phone_validator/`)

**Purpose**: Validates phone numbers (format, country code, carrier).

**Input**: `phone-validation-requests` topic  
**Output**: Validation results to `conductor-events`

---

#### f. **Enricher** (`enricher/`)

**Purpose**: Enriches data with additional attributes from external sources.

**Input**: `enrichment-requests` topic  
**Output**: Enriched data to `conductor-events`

---

#### g. **Reverse Email** (`reverse_email/`)

**Purpose**: Performs reverse email lookups to find associated entities (Match and Append Service).

**Input**: Custom topic  
**Output**: Lookup results to `conductor-events`

---

### 5. **Infrastructure Services**

#### a. **Conductor Server**

**Purpose**: Workflow orchestration engine.

**Configuration**:
- Port: `8080` (API & UI)
- Database: In-memory (POC mode)
- Event Queue: Kafka
- Event Processor: Enabled for async patterns

**Features**:
- Workflow definition and versioning
- Task execution and state management
- Event-driven task completion
- Workflow status monitoring
- Retry and recovery mechanisms

---

#### b. **Kafka**

**Purpose**: Event streaming platform for async communication.

**Topics**:
- `conductor-events`: Central event bus for all completion events
- `airflow-trigger-requests`: Airflow DAG trigger requests
- `email-hygiene-requests`: Email hygiene processing requests
- `dag-monitor-queue`: DAG monitoring events
- `email-validation-requests`: Email validation requests
- `phone-validation-requests`: Phone validation requests
- `enrichment-requests`: Data enrichment requests

**Configuration**:
- Port: `9092`
- Replication Factor: 1 (POC)
- Auto-create topics: Enabled

---

#### c. **Zookeeper**

**Purpose**: Coordination service for Kafka.

**Port**: `2181`

---

#### d. **MinIO**

**Purpose**: S3-compatible object storage for local development.

**Ports**:
- API: `9000`
- Console: `9001`

**Credentials**:
- User: `minioadmin`
- Password: `minioadmin`

**Buckets**:
- `raw-data`: Input files
- `email-validation`: Email validation results
- `phone-validation`: Phone validation results
- `enrichment`: Enriched data
- `email-hygiene-output`: Email hygiene results
- `name-parse-output`: Name parse results

---

## 🛠️ Technology Stack

### Backend
- **Python 3.9+**: Core language for all microservices
- **FastAPI**: Modern async web framework
- **Kafka-Python**: Kafka client library
- **Boto3**: AWS S3 SDK
- **MinIO Python SDK**: MinIO client library
- **Requests**: HTTP client for API calls

### Orchestration & Messaging
- **Netflix Conductor 3.15.0**: Workflow orchestration
- **Apache Kafka 7.4.0**: Event streaming
- **Zookeeper 7.4.0**: Kafka coordination

### Frontend
- **React 18**: UI library
- **ReactFlow**: Flow diagram library
- **Material-UI**: Component library
- **Vite**: Build tool

### Storage
- **AWS S3**: Cloud object storage
- **MinIO**: Local S3-compatible storage

### External Integrations
- **Apache Airflow (MWAA)**: Complex data processing DAGs
- **DPServices**:  data processing microservices

### DevOps
- **Docker & Docker Compose**: Containerization
- **Nginx**: Reverse proxy for React app

---

## 📊 Data Flow

### Example: Name Parse Workflow

```
1. User designs workflow in React app
   ↓
2. React app sends workflow definition to Ingestion Service
   ↓
3. Ingestion Service:
   - Extracts XML config for name parsing
   - Converts XML → JSON using dpservices.bin
   - Uploads JSON to S3
   - Updates workflow with S3 URIs
   - Deploys workflow to Conductor
   - Triggers workflow execution
   ↓
4. Conductor executes workflow:
   - Task 1: KAFKA_PUBLISH (publish to airflow-trigger-requests)
   - Task 2: EVENT (wait for name_parse_completed)
   ↓
5. Airflow Adapter:
   - Consumes airflow-trigger-requests
   - Triggers Airflow DAG via MWAA API
   - Publishes monitoring event to dag-monitor-queue
   ↓
6. DAG Monitor Worker:
   - Consumes monitoring event
   - Polls Airflow API for DAG status (every 10s)
   - Waits for DAG completion
   ↓
7. When DAG completes:
   - Downloads stats from S3
   - Uploads stats to MinIO
   - Downloads output from S3
   - Uploads output to MinIO
   - Publishes name_parse_completed to conductor-events
   ↓
8. Event Router:
   - Consumes name_parse_completed event
   - Finds matching EVENT task in workflow
   - Completes EVENT task via Conductor API
   ↓
9. Conductor continues workflow:
   - Next task executes
   - Workflow eventually completes
   ↓
10. Ingestion Service:
    - Receives completion event via Kafka
    - Pushes stats to React app via WebSocket
    ↓
11. User sees real-time updates in React app
```

---

## 🚀 Setup & Installation

### Prerequisites

- **Docker** & **Docker Compose** installed
- **AWS Credentials** configured (for S3 access)
- **Node.js 18+** (for React app development)
- **Python 3.9+** (for local development)

### Step 1: Clone Repository

```bash
cd /Users/uverma/Library/CloudStorage/OneDrive-DataAxle/Documents/conductor_kafka_poc
```

### Step 2: Configure Environment Variables

Create `.env` file in `event_driven_poc/`:

```bash
# AWS Configuration
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_SESSION_TOKEN=your_session_token
AWS_DEFAULT_REGION=us-east-1

# S3 Configuration
S3_BUCKET=958825666686-dpservices-testing-data
S3_PREFIX=conductor-poc

# MWAA Configuration
MWAA_ENDPOINT=https://your-mwaa-endpoint.airflow.amazonaws.com:443
MWAA_SESSION_TOKEN=your_mwaa_token

# Conductor Configuration
CONDUCTOR_URL=http://conductor-server:8080

# Kafka Configuration
KAFKA_BOOTSTRAP=kafka:9092

# MinIO Configuration
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
```

### Step 3: Start Infrastructure

```bash
cd event_driven_poc
docker-compose up -d
```

**Services will start in this order**:
1. Zookeeper
2. Kafka
3. MinIO
4. Conductor Server
5. Event Router
6. Microservices (Email Validator, Phone Validator, Enricher, etc.)
7. Ingestion Service
8. Airflow Adapter
9. Email Hygiene Service
10. Reverse Email Service
11. DAG Monitor Worker

### Step 4: Verify Services

```bash
# Check all containers are running
docker-compose ps

# Check Conductor UI
open http://localhost:8080

# Check MinIO Console
open http://localhost:9001

# Check Ingestion Service
curl http://localhost:8000/health
```

### Step 5: Start React Workflow Designer

```bash
cd ../react_workflow_app
npm install
npm run dev
```

Open http://localhost:5173

---

## 📖 Usage

### Creating a Workflow

1. **Open React Workflow Designer**: Navigate to http://localhost:5173

2. **Design Workflow**:
   - Drag nodes from the palette onto the canvas
   - Connect nodes by dragging from source (right handle) to target (left handle)
   - Click edit icon on each node to configure:
     - Task name
     - Kafka topic
     - Input parameters
     - Sink address (for EVENT tasks)

3. **Configure Workflow Settings**:
   - Set workflow name (e.g., `data_processing_workflow`)
   - Add description
   - Set owner email

4. **Preview JSON**:
   - Click "View JSON" to see generated Conductor workflow
   - Review task definitions and connections

5. **Deploy Workflow**:
   - Click "Deploy" button
   - Enter Conductor URL: `http://localhost:8000/workflow/deploy`
   - Click "Deploy"
   - Workflow will be deployed and triggered automatically

6. **Monitor Execution**:
   - View workflow status in Conductor UI: http://localhost:8080
   - Check real-time updates in React app (WebSocket connection)
   - View task execution logs in Conductor

### Example: Email Hygiene Workflow

```json
{
  "name": "email_hygiene_workflow",
  "version": 1,
  "tasks": [
    {
      "name": "dp_email_hygiene",
      "taskReferenceName": "dp_email_hygiene",
      "type": "KAFKA_PUBLISH",
      "inputParameters": {
        "kafka_request": {
          "topic": "email-hygiene-requests",
          "bootStrapServers": "kafka:9092",
          "key": "email-hygiene-${workflow.workflowId}",
          "value": {
            "workflowId": "${workflow.workflowId}",
            "taskId": "email_hygiene_task",
            "eventType": "email_hygiene_request",
            "data": {
              "dagId": "nua-emailhygiene-process-stage-v01-01-04-tiny",
              "executionId": "WBEmailHygiene",
              "dp_config": "<service>...</service>"
            }
          }
        }
      }
    },
    {
      "name": "wait_for_email_hygiene_completion",
      "taskReferenceName": "wait_for_email_hygiene_completion",
      "type": "EVENT",
      "sink": "conductor:email_hygiene_completed",
      "inputParameters": {}
    }
  ]
}
```

### Monitoring Workflows

1. **Conductor UI**: http://localhost:8080
   - View all workflow executions
   - See task status and outputs
   - Retry failed workflows
   - View execution timeline

2. **React App WebSocket**:
   - Real-time stats updates
   - Workflow completion notifications
   - Error alerts

3. **Docker Logs**:
```bash
# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f event-router
docker-compose logs -f airflow-adapter
docker-compose logs -f dag-monitor-worker
```

---

## ✨ Key Features

### 1. **Event-Driven Architecture**
- **Asynchronous Processing**: Microservices don't block waiting for responses
- **Loose Coupling**: Services communicate via events, not direct calls
- **Scalability**: Each service scales independently based on Kafka partition load

### 2. **Sink-Based Event Pattern**
- **True Async**: Conductor tasks publish to Kafka and wait for results via sink
- **No Polling**: Eliminates need for custom wait tasks
- **Direct Integration**: Microservices publish completion directly to Conductor

### 3. **Automatic Retry & Recovery**
- **Failure Detection**: Ingestion service monitors for failed tasks
- **Smart Retry**: Identifies correct restart point (handles EVENT task dependencies)
- **User Control**: Sends retry payload to UI for user confirmation

### 4. **Visual Workflow Designer**
- **No Code Required**: Create workflows via drag-and-drop
- **Live Preview**: See JSON as you design
- **Template Library**: Start with pre-built patterns
- **Direct Deployment**: Deploy to Conductor with one click

### 5. **Real-Time Monitoring**
- **WebSocket Updates**: Live stats pushed to UI
- **Kafka Event Stream**: All events logged to `conductor-events`
- **Conductor Dashboard**: Detailed execution view

### 6. **Hybrid Storage**
- **S3 for Production**: Production data stored in AWS S3
- **MinIO for Development**: Local S3-compatible storage
- **Automatic Sync**: Services sync data between S3 and MinIO


---

## 🌐 API Endpoints

### Ingestion Service (Port 8000)

#### `POST /workflow/deploy`

Deploy and trigger a workflow.

**Request Body**:
```json
{
  "workflow": {
    "name": "my_workflow",
    "version": 1,
    "tasks": [...]
  },
  "workflow_id": "optional-custom-id",
  "trigger_conductor": true
}
```

**Response**:
```json
{
  "runId": "run-20260111-abc123",
  "s3_input_uri": "s3://bucket/conductor-poc/runs/workflow-id/input.in",
  "s3_output_uri": "s3://bucket/conductor-poc/runs/workflow-id/output.out",
  "s3_report_uri": "s3://bucket/conductor-poc/runs/workflow-id/report.txt",
  "updated_json_uri": "s3://bucket/conductor-poc/service.json",
  "workflow_instance_id": "c123e456-f789-g012-h345-i678j901k234",
  "message": "Workflow deployed and triggered successfully"
}
```

#### `WS /ws`

WebSocket endpoint for real-time updates.

**Message Format**:
```json
{
  "workflow_id": "workflow-id",
  "taskId": "task-id",
  "stats_url": "minio://bucket/stats.jsonl",
  "content": "{ ... stats data ... }"
}
```

#### `POST /retry-workflow`

Retry a failed workflow.

**Request Body**:
```json
{
  "rerun_url": "http://conductor-server:8080/api/workflow/{workflowId}/rerun",
  "payload": {
    "workflowId": "workflow-id",
    "reRunFromTaskRefName": "task_name",
    "resetTasks": ["task1", "task2"]
  }
}
```

### Conductor API (Port 8080)

#### `POST /api/metadata/workflow`

Register workflow definition.

#### `POST /api/workflow/{name}`

Trigger workflow execution.

#### `GET /api/workflow/{workflowId}`

Get workflow execution details.

#### `POST /api/workflow/{workflowId}/rerun`

Retry workflow from specific task.

---

## 🐛 Troubleshooting

### Services Not Starting

**Issue**: Containers fail to start or show unhealthy status.

**Solution**:
```bash
# Check logs
docker-compose logs -f

# Restart specific service
docker-compose restart <service-name>

# Rebuild and restart
docker-compose down
docker-compose up -d --build
```

### Kafka Connection Errors

**Issue**: Services can't connect to Kafka.

**Solution**:
```bash
# Check Kafka is running
docker-compose ps kafka

# Check Kafka logs
docker-compose logs -f kafka

# Verify Kafka topics
docker-compose exec kafka kafka-topics --list --bootstrap-server localhost:9092
```

### Workflow Not Progressing

**Issue**: Workflow stuck in IN_PROGRESS state.

**Possible Causes**:
1. EVENT task not finding matching completion event
2. Microservice not processing request
3. Airflow DAG not completing

**Debug Steps**:
```bash
# Check event-router logs
docker-compose logs -f event-router

# Check specific microservice logs
docker-compose logs -f airflow-adapter
docker-compose logs -f email-hygiene

# Check Conductor events
docker-compose exec kafka kafka-console-consumer --bootstrap-server localhost:9092 --topic conductor-events --from-beginning
```

### Airflow DAG Failures

**Issue**: DAG runs fail or time out.

**Solution**:
```bash
# Check MWAA credentials
echo $MWAA_ENDPOINT
echo $MWAA_SESSION_TOKEN

# Check airflow-adapter logs
docker-compose logs -f airflow-adapter

# Check dag-monitor-worker logs
docker-compose logs -f dag-monitor-worker

# Manually check DAG status in Airflow UI
```

### S3/MinIO Access Issues

**Issue**: Can't upload/download files.

**Solution**:
```bash
# Check AWS credentials
aws s3 ls s3://your-bucket/

# Check MinIO
docker-compose logs -f minio

# Test MinIO access
open http://localhost:9001
# Login: minioadmin / minioadmin
```

### React App Not Deploying Workflows

**Issue**: Deploy button fails or returns errors.

**Solution**:
```bash
# Check ingestion service is running
curl http://localhost:8000/health

# Check browser console for errors
# Open DevTools → Console

# Verify CORS headers
# Check Network tab in DevTools

# Check ingestion service logs
docker-compose logs -f ingestion-service
```

---

## 📚 Additional Resources

### Documentation
- [Netflix Conductor Docs](https://conductor-oss.github.io/conductor/)
- [Apache Kafka Docs](https://kafka.apache.org/documentation/)
- [ReactFlow Docs](https://reactflow.dev/)
- [FastAPI Docs](https://fastapi.tiangolo.com/)

### Project Structure
```
conductor_kafka_poc/
├── event_driven_poc/
│   ├── docker-compose.yaml         # Infrastructure configuration
│   ├── event_router/               # Event routing service
│   ├── ingestion_service/          # Main ingestion & deployment service
│   ├── microservices/
│   │   ├── airflow_adapter/        # Airflow DAG trigger service
│   │   ├── dag_monitor_worker/     # DAG monitoring service
│   │   ├── email_hygiene/          # Email hygiene processing
│   │   ├── email_validator/        # Email validation
│   │   ├── phone_validator/        # Phone validation
│   │   ├── enricher/               # Data enrichment
│   │   └── reverse_email/          # Reverse email lookup
│   └── sample_data/                # Test datasets
└── react_workflow_app/             # Visual workflow designer
    ├── src/
    │   ├── components/             # React components
    │   ├── api/                    # API client
    │   └── utils/                  # Utility functions
    └── Dockerfile                  # Production build
```

---

## 🤝 Contributing

This is a POC project. For contributions or questions, contact the project maintainers(Ujjwal Verma,Viren Dattani,Vivek Srivastava,Manish Patel).

---

## 📄 License

Internal use only - DataAxle.

---

## 🙏 Acknowledgments

- **Netflix Conductor** - Workflow orchestration framework
- **Apache Kafka** - Event streaming platform
- **ReactFlow** - Visual workflow library
- **FastAPI** - Modern Python web framework

---


