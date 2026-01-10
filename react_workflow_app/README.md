# ReactFlow Workflow Designer for Netflix Conductor

A visual workflow designer built with React and ReactFlow that generates JSON workflows for Netflix Conductor orchestration.

## Features

- 🎨 **Drag-and-Drop Interface** - Intuitive visual workflow design
- 📊 **Real-time Preview** - See your workflow as you build it
- 🔄 **JSON Export** - Generate valid Conductor workflow JSON
- 🚀 **Direct Deployment** - Deploy workflows to Conductor server
- 📝 **Pre-built Templates** - Start with common workflow patterns
- ✅ **Validation** - Automatic workflow validation before deployment

## Node Types

### 1. Kafka Publish Node
- **Type:** `KAFKA_PUBLISH`
- **Purpose:** Publishes messages to Kafka topics
- **Configuration:**
  - Task name (unique identifier)
  - Topic name
  - Bootstrap servers
  - Message key template (with Conductor expressions)
  - Value template (JSON message body)
  - **Sink support** (optional) - For event-driven response handling
    - Enable/disable sink functionality
    - Configure sink address (e.g., `conductor:email_validation_completed`)
    - Conductor will wait for microservice response on the sink

### 2. Wait For Result Node
- **Type:** `wait_for_result`
- **Purpose:** Waits for responses from Kafka result topics
- **Configuration:**
  - Result topic name
  - Timeout duration (seconds)

### 3. Fork/Join Node
- **Type:** `FORK_JOIN`
- **Purpose:** Execute multiple branches in parallel
- **Configuration:**
  - Branch names
  - Join strategy

## Installation

```bash
cd reactflow-workflow-designer
npm install
```

## Development

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

## Usage

### 1. Quick Start with Template
- Click "Direct Integration Pipeline" template in the sidebar
- A complete 4-stage workflow will load on the canvas
- Click any node's edit icon to customize configuration

### 2. Design Custom Workflow
- Drag nodes from the "Node Palette" onto the canvas
- Connect nodes by dragging from right handle to left handle
- Click the edit icon on each node to configure:
  - Task name and label
  - Topic and Kafka servers
  - Enable sink for event-driven responses
  - Configure message key and value templates

### 3. Configure Workflow Settings
In the left sidebar "Workflow Settings":
- Set workflow name (e.g., `direct_integration_workflow`)
- Add description
- Set owner email

### 4. Export JSON
- Click "View JSON" to see generated Conductor workflow
- Review the JSON structure with syntax highlighting
- Click "Download" to save JSON file locally

### 5. Deploy to Conductor
- Click "Deploy" button
- Enter Conductor server URL (e.g., `http://localhost:8080`)
- Click "Deploy" to push workflow to Conductor server
- See success/error status immediately

## Templates

### 1. Direct Integration Pipeline ⭐ NEW
Complete 4-stage event-driven pipeline using sink-based pattern:
```
[Email Validation] → [Phone Validation] → [Enrichment] → [Finalize]
```
- Uses `sink` parameter for direct microservice integration
- No wait tasks needed - Conductor receives responses via sink
- Example of production-ready event-driven architecture
- See [SAMPLE_OUTPUT.json](./SAMPLE_OUTPUT.json) for complete generated JSON

### 2. Simple Validation
Single microservice validation workflow:
```
[Publish Email] → [Wait Email Result]
```

### 3. Sequential Pipeline
Email followed by phone validation:
```
[Publish Email] → [Wait Email] → [Publish Phone] → [Wait Phone]
```

### 4. Parallel Validation
Email and phone validation in parallel:
```
                  ┌─→ [Publish Email] → [Wait Email]
[Fork] ───────────┤
                  └─→ [Publish Phone] → [Wait Phone]
```

## Generated JSON Structure

The designer generates Conductor-compliant workflow JSON with full metadata:

```json
{
  "name": "direct_integration_workflow",
  "description": "Event-driven pipeline with direct Conductor-microservice integration",
  "version": 2,
  "tasks": [
    {
      "name": "start_pipeline",
      "taskReferenceName": "start_pipeline",
      "type": "KAFKA_PUBLISH",
      "inputParameters": {
        "kafka_request": {
          "topic": "email-validation-requests",
          "bootStrapServers": "kafka:9092",
          "value": {
            "workflowId": "${workflow.workflowId}",
            "taskId": "email_validation_task",
            "eventType": "email_validation_request",
            "data": {
              "input_bucket": "raw-data",
              "input_key": "customer_data_sample.csv",
              "output_bucket": "email-validated",
              "pipelineStage": "email_validation"
            }
          },
          "key": "email-validation-${workflow.instanceId}"
        }
      },
      "sink": "conductor:email_validation_completed"
    }
  ],
  "inputParameters": [],
  "outputParameters": {
    "pipeline_result": "${finalize_pipeline.output}",
    "workflow_id": "${workflow.workflowId}"
  },
  "schemaVersion": 2,
  "restartable": true,
  "workflowStatusListenerEnabled": true,
  "ownerEmail": "team@company.com"
}
```

### Workflow Metadata Fields
- `name` - Workflow identifier
- `description` - What the workflow does
- `version` - Workflow version number
- `restartable` - Whether workflow can be restarted on failure
- `workflowStatusListenerEnabled` - Enable status change notifications
- `ownerEmail` - Team contact for this workflow

See [SAMPLE_OUTPUT.json](./SAMPLE_OUTPUT.json) for a complete 4-task pipeline example.

## Sink-Based Event Pattern 🎯

The designer now supports Conductor's **sink-based event pattern** for true event-driven microservice integration:

### How It Works
1. **Task publishes to Kafka** with unique correlation ID
2. **Sink is configured** (e.g., `conductor:email_validation_completed`)
3. **Microservice processes** the message asynchronously
4. **Microservice publishes response** to the sink address
5. **Conductor receives response** and continues workflow execution

### Benefits
- ✅ No polling or wait tasks needed
- ✅ True asynchronous, event-driven architecture
- ✅ Reduced latency and resource usage
- ✅ Better scalability for high-throughput pipelines
- ✅ Decoupled microservices

### Example Configuration
When editing a Kafka Publish node:
- Enable "Enable Sink (Wait for Kafka Response)" toggle
- Set sink address: `conductor:email_validation_completed`
- Microservice must publish response to this sink for workflow to continue

## API Integration

### Deploy Workflow
```typescript
import { deployConductorWorkflow } from './api/conductorApi';

const workflow = convertToConductorJSON(nodes, edges, 'my_workflow');
await deployConductorWorkflow('http://localhost:8080', workflow);
```

### Trigger Workflow
```typescript
import { triggerWorkflow } from './api/conductorApi';

const workflowId = await triggerWorkflow(
  'http://localhost:8080',
  'direct_integration_workflow',
  { email: 'test@example.com', phone: '+1234567890' }
);
```

### Check Status
```typescript
import { getWorkflowStatus } from './api/conductorApi';

const status = await getWorkflowStatus('http://localhost:8080', workflowId);
console.log(status.status); // RUNNING, COMPLETED, FAILED, etc.
```

## Building for 150 Microservices

### Strategy 1: Sequential Workflow
```typescript
// Generate 150 sequential tasks
const nodes = [];
const edges = [];

for (let i = 0; i < 150; i++) {
  const publishNode = {
    id: `publish-${i}`,
    type: 'kafkaPublish',
    position: { x: i * 300, y: 100 },
    data: {
      label: `Service ${i}`,
      topic: `service-${i}-requests`,
      bootStrapServers: 'kafka:29092',
    },
  };
  
  const waitNode = {
    id: `wait-${i}`,
    type: 'waitForResult',
    position: { x: i * 300 + 150, y: 100 },
    data: {
      label: `Wait Service ${i}`,
      topic: `service-${i}-results`,
      timeout: 120,
    },
  };
  
  nodes.push(publishNode, waitNode);
  edges.push({ id: `e-${i}`, source: publishNode.id, target: waitNode.id });
  
  if (i > 0) {
    edges.push({ id: `e-link-${i}`, source: `wait-${i-1}`, target: publishNode.id });
  }
}
```

### Strategy 2: Parallel Workflow (Fork/Join)
```typescript
// Generate parallel branches for faster execution
const forkNode = {
  id: 'fork-main',
  type: 'forkJoin',
  position: { x: 100, y: 200 },
  data: {
    label: 'Parallel Fork (150 services)',
    branches: Array.from({ length: 150 }, (_, i) => `service-${i}`),
  },
};

// Create 150 branches, each with publish + wait
const branches = [];
for (let i = 0; i < 150; i++) {
  branches.push([
    {
      id: `publish-${i}`,
      type: 'kafkaPublish',
      data: { topic: `service-${i}-requests` },
    },
    {
      id: `wait-${i}`,
      type: 'waitForResult',
      data: { topic: `service-${i}-results` },
    },
  ]);
}
```

## Docker Deployment

```bash
# Build
docker build -t conductor-workflow-designer .

# Run
docker run -p 5173:5173 conductor-workflow-designer
```

## Environment Variables

```bash
VITE_CONDUCTOR_URL=http://localhost:8080
VITE_DEFAULT_KAFKA_SERVERS=kafka:29092
```

## Troubleshooting

### Workflow not deploying
- Verify Conductor server is running: `curl http://localhost:8080/api/health`
- Check for CORS issues in browser console
- Ensure task definitions are registered first

### Nodes not connecting
- Ensure connections are from source (right) handle to target (left) handle
- Check for cycles in the workflow (Conductor requires DAG)

### JSON validation errors
- Review generated JSON in "View JSON" dialog
- Check for duplicate task reference names
- Ensure all required fields are filled

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- GitHub Issues: [Create issue](https://github.com/yourorg/conductor-workflow-designer/issues)
- Documentation: [Conductor Docs](https://conductor-oss.github.io/conductor/)

---

**Built with:**
- [React](https://react.dev/) - UI framework
- [ReactFlow](https://reactflow.dev/) - Flow diagram library
- [Material-UI](https://mui.com/) - Component library
- [Axios](https://axios-http.com/) - HTTP client
- [Vite](https://vitejs.dev/) - Build tool

"# reactflow_workflow_designer" 
