# Architecture Deep Dive

## 📐 System Architecture

### Overview

This system implements a **microservices-based, event-driven architecture** using Netflix Conductor for orchestration and Apache Kafka for asynchronous communication. The architecture follows modern cloud-native patterns for scalability, resilience, and maintainability.

---

## 🎯 Core Design Principles

### 1. Event-Driven Communication

**Traditional Approach (Synchronous)**:
```
Service A → HTTP Request → Service B → HTTP Response → Service A
```
- Tight coupling
- Service A blocks waiting for Service B
- Cascading failures
- Limited scalability

**Our Approach (Asynchronous Event-Driven)**:
```
Service A → Kafka Event → Service B (processes async)
             ↓
Conductor ← Kafka Event ← Service B (publishes completion)
```
- Loose coupling
- Non-blocking operations
- Independent scaling
- Fault isolation

### 2. Sink-Based Event Pattern

**Problem**: How does Conductor know when an async task completes?

**Traditional Solution (Polling)**:
```
Conductor publishes event → Wait Task polls Kafka → Finds result → Continues
```
- Inefficient (continuous polling)
- Higher latency
- Resource intensive

**Our Solution (Sink-Based)**:
```
Conductor publishes event with sink address →
Microservice processes →
Microservice publishes to sink →
Event Router completes EVENT task →
Conductor continues immediately
```
- Efficient (event-driven)
- Lower latency
- Resource efficient

### 3. Separation of Concerns

Each component has a single, well-defined responsibility:

| Component | Responsibility |
|-----------|---------------|
| **React App** | Visual workflow design & user interaction |
| **Ingestion Service** | Workflow deployment & data ingestion |
| **Conductor** | Workflow orchestration & state management |
| **Event Router** | Route completion events to Conductor |
| **Microservices** | Domain-specific processing |
| **DAG Monitor** | Airflow integration & monitoring |
| **Kafka** | Event streaming & message delivery |

### 4. Scalability by Design

```
┌─────────────────────────────────────────────────────────────┐
│                    Horizontal Scaling                        │
├─────────────────────────────────────────────────────────────┤
│  Kafka Topics (Partitioned)                                 │
│    ├─ Partition 0 → Consumer Instance 1                     │
│    ├─ Partition 1 → Consumer Instance 2                     │
│    └─ Partition N → Consumer Instance N                     │
└─────────────────────────────────────────────────────────────┘
```

- Each microservice can be scaled independently
- Kafka partitions enable parallel processing
- No shared state between service instances

---

## 🔄 Data Flow Patterns

### Pattern 1: Simple Async Task

```
┌──────────────┐
│  Conductor   │
└──────┬───────┘
       │ 1. Publish event
       │    (KAFKA_PUBLISH task)
       ▼
┌────────────────────┐
│  Kafka Topic       │
│  (request topic)   │
└──────┬─────────────┘
       │ 2. Consume event
       ▼
┌────────────────────┐
│  Microservice      │
│  - Process data    │
│  - Store result    │
└──────┬─────────────┘
       │ 3. Publish completion
       │    (to conductor-events)
       ▼
┌────────────────────┐
│  Kafka Topic       │
│  (conductor-events)│
└──────┬─────────────┘
       │ 4. Route event
       ▼
┌────────────────────┐
│  Event Router      │
│  - Find EVENT task │
│  - Complete task   │
└──────┬─────────────┘
       │ 5. Task completion
       ▼
┌────────────────────┐
│  Conductor API     │
│  POST /tasks       │
└──────┬─────────────┘
       │ 6. Continue workflow
       ▼
┌────────────────────┐
│  Next Task         │
└────────────────────┘
```

### Pattern 2: Airflow Integration (Complex)

```
┌──────────────┐
│  Conductor   │
└──────┬───────┘
       │ 1. Publish Airflow trigger request
       ▼
┌────────────────────┐
│  Kafka Topic       │
│  (airflow-trigger) │
└──────┬─────────────┘
       │ 2. Consume trigger event
       ▼
┌────────────────────┐
│  Airflow Adapter   │
│  - Trigger DAG     │
│  - Get dag_run_id  │
└──────┬─────────────┘
       │ 3. Publish monitoring event
       ▼
┌────────────────────┐
│  Kafka Topic       │
│  (dag-monitor)     │
└──────┬─────────────┘
       │ 4. Consume monitoring event
       ▼
┌────────────────────┐
│  DAG Monitor       │
│  - Poll Airflow    │
│  - Wait for done   │
│  - Download files  │
└──────┬─────────────┘
       │ 5. Publish completion
       ▼
┌────────────────────┐
│  Event Router      │
└──────┬─────────────┘
       │ 6. Complete EVENT task
       ▼
┌────────────────────┐
│  Conductor         │
└────────────────────┘
```

**Why This Pattern?**
- Airflow DAGs are long-running (minutes to hours)
- Polling is done by dedicated worker (not blocking Conductor)
- Separates concerns: trigger vs. monitor
- Enables parallel monitoring of multiple DAGs

### Pattern 3: Parallel Processing (Fork/Join)

```
                  ┌──────────────────┐
                  │   Conductor      │
                  │   (FORK_JOIN)    │
                  └────────┬─────────┘
                           │
            ┌──────────────┴──────────────┐
            │                             │
            ▼                             ▼
    ┌───────────────┐            ┌───────────────┐
    │  Branch 1     │            │  Branch 2     │
    │  Email        │            │  Phone        │
    │  Validation   │            │  Validation   │
    └───────┬───────┘            └───────┬───────┘
            │                             │
            └──────────────┬──────────────┘
                           │ (JOIN)
                           ▼
                  ┌────────────────┐
                  │  Continue      │
                  │  Workflow      │
                  └────────────────┘
```

**Benefits**:
- Parallel execution reduces total time
- Independent failure handling per branch
- Conductor manages synchronization (JOIN)

---

## 🧩 Component Interactions

### 1. Workflow Deployment Flow

```
┌────────────────────────────────────────────────────────────────┐
│                     User Action                                │
│  React App → Design Workflow → Click "Deploy"                 │
└────────────┬───────────────────────────────────────────────────┘
             │ HTTP POST /workflow/deploy
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Ingestion Service                               │
│                                                                 │
│  1. Extract XML configs from workflow tasks                    │
│  2. Convert XML → JSON using dpservices.bin                    │
│  3. Upload JSON to S3                                          │
│  4. Download input file from MinIO → Upload to S3              │
│  5. Update workflow tasks with S3 URIs                         │
│  6. Deploy workflow to Conductor (POST /api/metadata/workflow) │
│  7. Trigger workflow execution (POST /api/workflow/{name})     │
│  8. Return workflow_instance_id to React app                   │
└─────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Conductor Execution                             │
│                                                                 │
│  1. Start workflow                                             │
│  2. Execute first task (usually KAFKA_PUBLISH)                 │
│  3. Wait for EVENT task completion                             │
│  4. Continue to next task                                      │
│  5. Repeat until workflow completes                            │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Event Routing Flow

```
┌─────────────────────────────────────────────────────────────────┐
│               Microservice Completes Processing                 │
│                                                                 │
│  microservice.publish_completion_event():                      │
│    - workflowId: "abc-123"                                     │
│    - taskId: "email_hygiene_task"                              │
│    - eventType: "email_hygiene_completed"                      │
│    - data: { status: "success", ... }                          │
└─────────────┬───────────────────────────────────────────────────┘
              │ Publish to Kafka
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Kafka: conductor-events                        │
└─────────────┬───────────────────────────────────────────────────┘
              │ Consume
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Event Router                                │
│                                                                 │
│  1. extract_event_type(event)                                  │
│     → "email_hygiene_completed"                                │
│                                                                 │
│  2. find_matching_event_task(workflowId, eventType)            │
│     → GET /api/workflow/{workflowId}?includeTasks=true         │
│     → Filter tasks where:                                      │
│        - taskType == "EVENT"                                   │
│        - status == "IN_PROGRESS"                               │
│        - sink matches eventType                                │
│     → Found: task_id="xyz-789"                                 │
│                                                                 │
│  3. complete_event_task(workflowId, taskId, outputData)        │
│     → POST /api/tasks                                          │
│        {                                                       │
│          "workflowInstanceId": "abc-123",                      │
│          "taskId": "xyz-789",                                  │
│          "status": "COMPLETED",                                │
│          "outputData": { ... }                                 │
│        }                                                       │
└─────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Conductor Continues Workflow                   │
└─────────────────────────────────────────────────────────────────┘
```

**Key Matching Logic**:
```python
# Event Router: find_matching_event_task()

# Step 1: Try exact task ID match (if provided in event)
if task_id_from_event:
    matching_task = find_task_by_id(tasks, task_id_from_event)
    if matching_task and matching_task.taskType == "EVENT":
        return matching_task

# Step 2: Try sink-based matching
for task in in_progress_event_tasks:
    task_sink = task.get('sink')  # e.g., "conductor:email_hygiene_completed"
    sink_event_type = normalize_sink(task_sink)  # → "email_hygiene_completed"
    
    if sink_event_type.lower() == event_type.lower():
        return task  # Exact match

# Step 3: Fallback to reference name mapping
task_ref_name = EVENT_TO_TASK_MAPPING.get(event_type)
if task_ref_name:
    matching_task = find_task_by_ref_name(tasks, task_ref_name)
    return matching_task

# Step 4: No match found
return None
```

### 3. Retry Mechanism Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                  Workflow Execution Fails                       │
│  (Task status: FAILED)                                         │
└─────────────┬───────────────────────────────────────────────────┘
              │ Event published to conductor-events
              ▼
┌─────────────────────────────────────────────────────────────────┐
│               Ingestion Service (Kafka Consumer)                │
│                                                                 │
│  1. Detect status == "failed" in event                         │
│  2. process_retry_full(workflowId, event):                     │
│     a. GET /api/workflow/{workflowId}                          │
│     b. Find first failed task index                            │
│     c. Determine restart index:                                │
│        - If failed task is EVENT → restart from previous       │
│        - Otherwise → restart from failed task                  │
│     d. Build reset_tasks list (all tasks from restart point)   │
│     e. Create retry payload:                                   │
│        {                                                       │
│          "workflowId": "abc-123",                              │
│          "reRunFromTaskRefName": "trigger_email_hygiene",      │
│          "resetTasks": ["trigger_email_hygiene",               │
│                         "wait_for_email_hygiene"]              │
│        }                                                       │
│     f. Push retry payload to UI via WebSocket                  │
└─────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    React App (WebSocket)                        │
│                                                                 │
│  1. Receive retry payload                                      │
│  2. Display retry button to user                               │
│  3. User clicks "Retry"                                        │
│  4. POST /retry-workflow (to Ingestion Service)                │
└─────────────┬───────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│           Ingestion Service (Retry Endpoint)                    │
│                                                                 │
│  POST /retry-workflow:                                         │
│    1. Extract rerun_url from payload                           │
│    2. Forward retry request to Conductor:                      │
│       POST {rerun_url} with payload                            │
└─────────────┬───────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Conductor (Rerun API)                              │
│                                                                 │
│  POST /api/workflow/{workflowId}/rerun:                        │
│    1. Reset specified tasks to SCHEDULED                       │
│    2. Re-execute from reRunFromTaskRefName                     │
│    3. Preserve workflow context and previous outputs           │
└─────────────────────────────────────────────────────────────────┘
```

**Why This Design?**
- **Automatic Detection**: System detects failures without user monitoring
- **Smart Restart**: Identifies correct restart point (handles EVENT dependencies)
- **User Control**: User confirms retry (prevents unwanted retries)
- **Preserves State**: Workflow context maintained across retries

---

## 📦 Storage Architecture

### Hybrid S3/MinIO Design

```
┌─────────────────────────────────────────────────────────────────┐
│                         Data Flow                               │
│                                                                 │
│  1. User uploads to MinIO (local testing)                      │
│     └─ minio://raw-data/input.in                               │
│                                                                 │
│  2. Ingestion Service downloads from MinIO                     │
│     └─ Local temp file                                         │
│                                                                 │
│  3. Ingestion Service uploads to S3 (production)               │
│     └─ s3://bucket/conductor-poc/runs/{workflowId}/input.in    │
│                                                                 │
│  4. Airflow DAG processes in S3                                │
│     └─ Output: s3://bucket/conductor-poc/runs/{wfId}/output.out│
│                                                                 │
│  5. DAG Monitor downloads from S3                              │
│     └─ Local temp file                                         │
│                                                                 │
│  6. DAG Monitor uploads to MinIO (for UI access)               │
│     └─ minio://output-bucket/output.out                        │
└─────────────────────────────────────────────────────────────────┘
```

**Why Hybrid?**
- **S3**: Production-ready, durable, accessible to Airflow
- **MinIO**: Local development, fast access, no AWS costs
- **Best of Both**: S3 for processing, MinIO for quick access

### File Naming Convention

```
S3 Structure:
s3://{bucket}/conductor-poc/
  ├── runs/
  │   └── {workflowId}/
  │       ├── input.in                    # Input data
  │       ├── output.out                  # Processed output
  │       ├── report/
  │       │   └── counts.txt              # Statistics
  │       ├── NameParse_Stats.jsonl       # Service stats
  │       └── Email_Hygiene_Stats.jsonl   # Service stats
  ├── dp_name_parse.json                  # Service config
  └── dp_email_hygiene.json               # Service config

MinIO Structure:
minio://
  ├── raw-data/
  │   └── input.in                        # Input files
  ├── name-parse-output/
  │   ├── nameparse.out                   # Output files
  │   └── NameParse_Stats.jsonl           # Stats
  └── email-hygiene-output/
      ├── email_hygiene.out
      └── Email_Hygiene_Stats.jsonl
```

---

## 🔐 Security Considerations

### 1. Service Communication

```
┌─────────────────────────────────────────────────────────────────┐
│              Internal Network (Docker Bridge)                   │
│                                                                 │
│  - All services communicate within private network             │
│  - No external exposure except designated ports                │
│  - Services reference by hostname (e.g., kafka:9092)           │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Exposed Ports

| Port | Service | Purpose | Public? |
|------|---------|---------|---------|
| 8080 | Conductor | API & UI | Yes (localhost only) |
| 8000 | Ingestion Service | Deployment API | Yes (localhost only) |
| 9000 | MinIO | S3 API | Yes (localhost only) |
| 9001 | MinIO | Web Console | Yes (localhost only) |
| 5173 | React App | Workflow Designer | Yes (localhost only) |
| 9092 | Kafka | Message Broker | No (internal) |
| 2181 | Zookeeper | Kafka Coordination | No (internal) |

### 3. Credentials Management

```yaml
# Production Recommendations:
AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}           # From environment
AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}   # From environment
AWS_SESSION_TOKEN: ${AWS_SESSION_TOKEN}           # From environment
MWAA_SESSION_TOKEN: ${MWAA_SESSION_TOKEN}         # From environment

# Avoid hardcoding in docker-compose.yaml
# Use .env file (not committed to git)
# Or AWS Secrets Manager / Parameter Store
```

---

## 🚀 Scalability Patterns

### 1. Horizontal Scaling (Microservices)

```yaml
# Scale a service to 3 instances
docker-compose up -d --scale email-validator=3

# Kafka automatically distributes load across instances
# via consumer groups
```

**How It Works**:
- Each instance joins the same consumer group
- Kafka assigns partitions to consumers
- Load balanced automatically

### 2. Kafka Partitioning

```
Topic: email-validation-requests (3 partitions)

Partition 0 → Consumer Instance 1
Partition 1 → Consumer Instance 2
Partition 2 → Consumer Instance 3

# Messages distributed by key:
kafka_request.key = "validation-${workflow.workflowId}"
# Same workflow always goes to same partition (ordering guaranteed)
```

### 3. Thread-Based Scaling (DAG Monitor)

```python
# dag_monitor_worker/service.py

executor = ThreadPoolExecutor(max_workers=10)

for message in consumer:
    event = message.value
    executor.submit(self.process_event, event)
    # Non-blocking: monitors up to 10 DAGs concurrently
```

**When to Use**:
- I/O-bound tasks (polling Airflow API)
- Long-running operations
- Independent processing units

---

## 🛡️ Fault Tolerance

### 1. Retry Mechanisms

**Airflow Adapter**:
```python
max_retries = 3
backoff_seconds = 2

for attempt in range(1, max_retries + 1):
    try:
        result = trigger_dag_run(...)
        if successful:
            return result
    except Exception as e:
        if attempt < max_retries:
            time.sleep(backoff_seconds)
            backoff_seconds *= 2  # Exponential backoff
        else:
            publish_failure_event(...)
```

**Benefits**:
- Handles transient failures (network issues, rate limits)
- Exponential backoff prevents overwhelming services
- Eventual failure notification

### 2. Health Checks

```yaml
# docker-compose.yaml

conductor-server:
  healthcheck:
    test: ["CMD", "wget", "--quiet", "--spider", "http://localhost:8080/health"]
    interval: 30s
    timeout: 10s
    retries: 5
    start_period: 60s
```

**Benefits**:
- Services wait for dependencies before starting
- Automatic restart on failure
- Visibility into service health

### 3. Kafka Consumer Groups

```python
consumer = KafkaConsumer(
    'conductor-events',
    group_id='event-router-group',  # Consumer group
    enable_auto_commit=True,
    auto_commit_interval_ms=1000
)
```

**Benefits**:
- Offset tracking (resume from last processed message)
- No duplicate processing after restart
- Fault tolerance via consumer group rebalancing

---

## 📊 Monitoring & Observability

### 1. Logs

Each service logs to stdout (captured by Docker):
```python
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
```

**View Logs**:
```bash
docker-compose logs -f event-router
docker-compose logs -f --tail=100 airflow-adapter
```

### 2. Conductor UI

http://localhost:8080
- Workflow executions
- Task status and outputs
- Timeline view
- Error details

### 3. WebSocket Updates

React app receives real-time updates:
```javascript
const ws = new WebSocket('ws://localhost:8000/ws');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // Display stats, errors, completion status
};
```

### 4. Kafka Monitoring

```bash
# Message count per topic
docker-compose exec kafka kafka-run-class kafka.tools.GetOffsetShell \
  --broker-list localhost:9092 \
  --topic conductor-events

# Consumer lag
docker-compose exec kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --describe --group event-router-group
```

---

## 🎓 Best Practices

### 1. Event Design

**Good Event Structure**:
```json
{
  "workflowId": "abc-123",           # Required: identifies workflow
  "taskId": "email_validation_task", # Required: identifies task
  "eventType": "email_hygiene_completed", # Required: for routing
  "data": {
    "status": "success",             # Required: success/failure
    "result": "success",             # For backwards compatibility
    "stats_url": "minio://...",      # Optional: additional data
    "output_uri": "s3://...",
    "timestamp": "2026-01-11T12:00:00Z"
  }
}
```

### 2. Task Naming

**Consistent Naming Convention**:
```
{service}_{action}_{stage}

Examples:
- dp_email_hygiene              # Service task
- wait_for_email_hygiene        # Wait task
- trigger_airflow_dag           # Trigger task
- email_hygiene_completed       # Event type
```

### 3. Error Handling

**Always Publish Completion Events**:
```python
try:
    result = process_data(...)
    publish_completion_event(status="success", data=result)
except Exception as e:
    logger.error(f"Error: {e}")
    publish_completion_event(
        status="failed",
        error_message=str(e)
    )
```

### 4. Idempotency

**Handle Duplicate Events**:
```python
# Use workflow_id + task_id as unique key
processed_events = set()

def process_event(event):
    key = f"{event['workflowId']}:{event['taskId']}"
    if key in processed_events:
        logger.info(f"Skipping duplicate event: {key}")
        return
    processed_events.add(key)
    # Process event...
```

---

## 🔮 Future Enhancements

### 1. Service Mesh (Istio/Linkerd)

- **Benefits**: Traffic management, observability, security
- **Implementation**: Add sidecar proxies to each service

### 2. Distributed Tracing (Jaeger/Zipkin)

- **Benefits**: End-to-end request tracing across services
- **Implementation**: Add trace IDs to events, instrument code

### 3. Schema Registry (Confluent Schema Registry)

- **Benefits**: Enforce event schema contracts, versioning
- **Implementation**: Define Avro/Protobuf schemas for events

### 4. Event Sourcing

- **Benefits**: Full audit trail, replay capability
- **Implementation**: Store all events in append-only log

### 5. CQRS (Command Query Responsibility Segregation)

- **Benefits**: Separate read/write models, optimized queries
- **Implementation**: Dedicated read models from event stream

---

## 📚 References

- [Netflix Conductor Documentation](https://conductor-oss.github.io/conductor/)
- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
- [Event-Driven Architecture Patterns](https://www.enterpriseintegrationpatterns.com/)
- [Microservices Patterns by Chris Richardson](https://microservices.io/patterns/)

---

**This architecture enables building scalable, resilient, event-driven data pipelines with minimal coupling and maximum flexibility.**
