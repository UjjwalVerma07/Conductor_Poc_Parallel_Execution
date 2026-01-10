import { Node, Edge } from 'reactflow';
// Converter: turns the ReactFlow graph into a Conductor workflow JSON.
// It standardizes names and auto-wires buckets/keys based on node connections.

interface ConductorTask {
  name: string;
  taskReferenceName: string;
  type?: string;
  inputParameters?: any;
  sink?: string;
  asyncComplete?: boolean;
}

interface ConductorWorkflow {
  name: string;
  description: string;
  version: number;
  tasks: ConductorTask[];
  inputParameters: any[];
  outputParameters: any;
  schemaVersion: number;
  restartable?: boolean;
  workflowStatusListenerEnabled?: boolean;
  ownerEmail?: string;
}

/** Converts ReactFlow graph to Conductor workflow JSON */
export function convertToConductorJSON(
  nodes: Node[],
  edges: Edge[],
  workflowName: string
): ConductorWorkflow {
  // Build adjacency map for topological sort
  const adjacencyMap = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  nodes.forEach((node) => {
    adjacencyMap.set(node.id, []);
    inDegree.set(node.id, 0);
  });

  edges.forEach((edge) => {
    adjacencyMap.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  });

  // Debug: Log edges and in-degrees
  console.log('Edges:', edges.map(e => ({ from: e.source, to: e.target })));
  console.log('In-degrees:', Array.from(inDegree.entries()).map(([id, deg]) => ({ id, degree: deg })));

  // Topological sort to determine task order
  const sortedNodes = topologicalSort(nodes, adjacencyMap, inDegree);
  
  // Debug: Log the sorted order
  console.log('Topologically sorted nodes:', sortedNodes.map(n => ({ 
    id: n.id, 
    type: n.type, 
    label: n.data?.label || n.data?.serviceName || n.id 
  })));

  // Convert nodes to Conductor tasks
  const tasks: ConductorTask[] = [];
  const outputParameters: any = {};
  const idToNode = new Map(nodes.map((n) => [n.id, n]));
  const incomingById = new Map<string, string[]>();

  edges.forEach((e) => {
    if (!incomingById.has(e.target)) incomingById.set(e.target, []);
    incomingById.get(e.target)!.push(e.source);
  });

  // Track computed outputs per node to feed into subsequent nodes
  const computedOutputs = new Map<string, { bucket: string; key: string; serviceName: string }>();
  let lastPublishOutputKey: string | null = null;

  // Find the first service node (excluding airflowTrigger and eventWait nodes)
  // This will be used to set raw-data input for the first service
  const serviceNodeTypes = new Set(['emailValidation', 'phoneValidation', 'enrichment']);
  let firstServiceNodeId: string | null = null;
  for (const node of sortedNodes) {
    if (serviceNodeTypes.has(node.type as string)) {
      const incoming = incomingById.get(node.id) || [];
      // Check if this node has no incoming service nodes (only eventWait or nothing)
      const hasIncomingService = incoming.some(srcId => {
        const srcNode = idToNode.get(srcId);
        return srcNode && serviceNodeTypes.has(srcNode.type as string);
      });
      if (!hasIncomingService) {
        firstServiceNodeId = node.id;
        break;
      }
    }
  }

  // Debug: Log final task order
  console.log('Final task order in workflow:', sortedNodes
    .filter(n => ['phoneValidation', 'enrichment', 'emailValidation', 'airflowTrigger', 'finalizePipeline'].includes(n.type as string))
    .map(n => ({ id: n.id, type: n.type, name: n.data?.label || n.data?.serviceName || n.id })));

  sortedNodes.forEach((node, index) => {
    const isFirstService = node.id === firstServiceNodeId;
    const task = convertNodeToTaskGeneric(node, index, incomingById, computedOutputs, idToNode, isFirstService);
    if (task) {
      tasks.push(task);
      console.log(`Added task ${index + 1}: ${task.name} (from node ${node.id}, type: ${node.type})`);

      // Collect outputs from wait_for_result tasks
      if (node.type === 'waitForResult') {
        const refName = task.taskReferenceName;
        // Conductor expression language reference to task output
        outputParameters[`${refName}_result`] = '${' + refName + '.output}';
      }

      // Auto-append EVENT wait tasks for publish-capable services (implicit wait nodes).
      // This keeps EVENT tasks in the Conductor payload without requiring a visible wait node in the UI.
      const autoWaitTypes = new Set([
        'airflowTrigger',
        'emailValidation',
        'phoneValidation',
        'enrichment',
        'dpEmailHygiene',
        'nameParse',
      ]);
      if (autoWaitTypes.has(node.type as string)) {
        const serviceName = canonicalServiceName(node.type as string, node);
        const ref =
          serviceName === 'airflow_processing'
            ? 'wait_for_airflow_completion'
            : `wait_for_${serviceName}_completion`;
        const eventTask: ConductorTask = {
          name: ref,
          taskReferenceName: ref,
          type: 'EVENT',
          sink:
            serviceName === 'airflow_processing'
              ? 'conductor:airflow_dag_completed'
              : `conductor:${serviceName}_completed`,
          asyncComplete: true,
        };
        tasks.push(eventTask);

        const pretty = prettyServiceKey(serviceName);
        outputParameters[`${pretty}_result`] = '${' + ref + '.output}';
      }

      // Track last publish output key (exclude finalize which doesn't produce a new output file)
      const publishTypes = new Set(['emailValidation', 'phoneValidation', 'enrichment']);
      if (publishTypes.has(node.type as string)) {
        const out = computedOutputs.get(node.id);
        if (out?.key) lastPublishOutputKey = out.key;
      }
    }
  });

  // Debug: Log final tasks array order
  console.log('Final tasks array order:', tasks.map((t, idx) => ({ 
    index: idx, 
    name: t.name, 
    type: t.type,
    taskReferenceName: t.taskReferenceName 
  })));

  // Build workflow with complete metadata
  // Use timestamp-based version to ensure new workflow is always registered
  const workflow: ConductorWorkflow = {
    name: workflowName,
    description: `Generated workflow with ${tasks.length} tasks`,
    version: Math.floor(Date.now() / 1000), // Use timestamp to force new version
    tasks,
    inputParameters: [],
    outputParameters: {
      pipeline_result: lastPublishOutputKey || '',
      workflow_id: '${workflow.workflowId}',
      workflowId: '${workflow.workflowId}',
      ...outputParameters,
    },
    schemaVersion: 2,
    restartable: true,
    workflowStatusListenerEnabled: false,
    // Optional: global timeouts per the sample
    // @ts-ignore
    timeoutPolicy: 'ALERT_ONLY' as any,
    // @ts-ignore
    timeoutSeconds: 3600 as any,
    ownerEmail: 'team@company.com',
  };

  // Debug: Log the complete workflow JSON structure
  console.log('Complete workflow JSON:', JSON.stringify(workflow, null, 2));

  return workflow;
}

// Basic Kahn topological sort with geometric tiebreaker for layout stability
function topologicalSort(
  nodes: Node[],
  adjacencyMap: Map<string, string[]>,
  inDegree: Map<string, number>
): Node[] {
  const queue: Node[] = [];
  const sorted: Node[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Find all nodes with no incoming edges
  nodes.forEach((node) => {
    if (inDegree.get(node.id) === 0) {
      queue.push(node);
    }
  });

  // Sort nodes by position (left to right, top to bottom) as tiebreaker
  // This ensures visual order is preserved when multiple nodes have no dependencies
  queue.sort((a, b) => {
    if (Math.abs(a.position.y - b.position.y) < 50) {
      return a.position.x - b.position.x;
    }
    return a.position.y - b.position.y;
  });

  console.log('Initial queue (nodes with no dependencies):', queue.map(n => ({ 
    id: n.id, 
    type: n.type, 
    x: n.position.x, 
    y: n.position.y 
  })));

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);

    console.log(`Processing node: ${node.id} (${node.type})`);

    // Reduce in-degree for neighbors
    const neighbors = adjacencyMap.get(node.id) || [];
    neighbors.forEach((neighborId) => {
      const newDegree = (inDegree.get(neighborId) || 0) - 1;
      inDegree.set(neighborId, newDegree);

      if (newDegree === 0) {
        const neighbor = nodeMap.get(neighborId);
        if (neighbor) {
          queue.push(neighbor);
          // Re-sort queue by position to maintain visual order when multiple nodes become available
          queue.sort((a, b) => {
            if (Math.abs(a.position.y - b.position.y) < 50) {
              return a.position.x - b.position.x;
            }
            return a.position.y - b.position.y;
          });
          console.log(`Added ${neighbor.id} to queue. Queue now:`, queue.map(n => n.id));
        }
      }
    });
  }

  // If not all nodes are sorted, there's a cycle (shouldn't happen in DAG)
  if (sorted.length !== nodes.length) {
    console.warn('Cycle detected in workflow graph, some nodes may be missing');
    console.warn('Expected', nodes.length, 'nodes, got', sorted.length);
    console.warn('Missing nodes:', nodes.filter(n => !sorted.includes(n)).map(n => n.id));
  }

  return sorted;
}

// Create a KAFKA_PUBLISH or WAIT task from a node, deriving names from serviceName
function convertNodeToTaskGeneric(
  node: Node,
  index: number,
  incomingById: Map<string, string[]>,
  computedOutputs: Map<string, { bucket: string; key: string; serviceName: string }>,
  idToNode: Map<string, Node>,
  isFirstService: boolean = false
): ConductorTask | null {
  // Publish-capable node types. Extend this set to onboard new services (e.g., 'nameParse')
  const publishTypes = new Set(['airflowTrigger', 'emailValidation', 'phoneValidation', 'enrichment', 'finalizePipeline', 'dpEmailHygiene', 'nameParse']);

  if (publishTypes.has(node.type as string)) {
    const serviceName = canonicalServiceName(node.type as string, node);
    const kebab = toKebab(serviceName);
    const snake = serviceName; // already snake

    // Determine input bucket/key
    const incoming = incomingById.get(node.id) || [];
    let input_bucket = node.data?.inputBucket || `${kebab}-input`;
    let input_key = node.data?.inputKey || 'input.csv';
    let previousStage: string | undefined = undefined;

    // If this is the first service (excluding airflowTrigger), use raw-data as input
    if (isFirstService && node.type !== 'airflowTrigger') {
      input_bucket = 'raw-data';
      input_key = 'customer_data_sample.csv';
    } else {
      // Find a predecessor with computed output
      for (const srcId of incoming) {
        const prevOut = computedOutputs.get(srcId);
        if (prevOut) {
          input_bucket = prevOut.bucket;
          input_key = prevOut.key;
          previousStage = prevOut.serviceName;
          break;
        }
      }
      // If incoming is an EVENT wait, look one step further to the publish node
      if (!previousStage && incoming.length > 0) {
        for (const srcId of incoming) {
          const upstreamNode = idToNode.get(srcId);
          if (upstreamNode && upstreamNode.type === 'eventWait') {
            const prevIncoming = incomingById.get(srcId) || [];
            const publishId = prevIncoming.length > 0 ? prevIncoming[0] : undefined;
            if (publishId) {
              const publishOut = computedOutputs.get(publishId);
              if (publishOut) {
                input_bucket = publishOut.bucket;
                input_key = publishOut.key;
                previousStage = publishOut.serviceName;
                break;
              }
            }
          }
        }
      }
    }

    // DP Email Hygiene specialized payload
    if (node.type === 'dpEmailHygiene') {
      // DP Email Hygiene: dp_config is a full dpservices XML produced in the node editor
      // We attach it verbatim so backend can dispatch without additional transforms
      // Parse output uri to expose for downstream if needed
      const dpOutUri: string | undefined = node.data?.outputUri;
      if (dpOutUri && dpOutUri.startsWith('s3://')) {
        const without = dpOutUri.replace('s3://', '');
        const slashIdx = without.indexOf('/');
        if (slashIdx > 0) {
          const bucket = without.substring(0, slashIdx);
          const key = without.substring(slashIdx + 1);
          computedOutputs.set(node.id, { bucket, key, serviceName: snake });
        }
      }
      // Attach XML string (built in node editor) as dp_config
      const dpConfig: string = (node.data?.dpserviceXml as string) || '';
      return {
        name: 'dp_email_hygiene',
        taskReferenceName: 'dp_email_hygiene',
        type: 'KAFKA_PUBLISH',
        inputParameters: {
          kafka_request: {
            // Hardcoded per backend contract for Email Hygiene
            topic: 'email-hygiene-requests',
            bootStrapServers: 'kafka:9092',
            value: {
              workflowId: '${workflow.workflowId}',
              taskId: 'dp_email_hygiene_task',
              // Hardcoded per backend contract for Email Hygiene
              eventType: 'email_hygiene_request',
              data: {
                dp_config: dpConfig,
              },
            },
            key: `dp-email-hygiene-${'${workflow.workflowId}'}`,
          },
        },
      };
    }

    // DP Name Parse specialized payload (dp_config dpservices XML created in node editor)
    if (node.type === 'nameParse') {
      const dpOutUri: string | undefined = node.data?.outputUri;
      if (dpOutUri && dpOutUri.startsWith('s3://')) {
        const without = dpOutUri.replace('s3://', '');
        const slashIdx = without.indexOf('/');
        if (slashIdx > 0) {
          const bucket = without.substring(0, slashIdx);
          const key = without.substring(slashIdx + 1);
          computedOutputs.set(node.id, { bucket, key, serviceName: snake });
        }
      }
      const dpConfig: string = (node.data?.dpserviceXml as string) || '';
      return {
        name: 'dp_name_parse',
        taskReferenceName: 'dp_name_parse',
        type: 'KAFKA_PUBLISH',
        inputParameters: {
          kafka_request: {
            // Hardcoded per backend contract for Name Parse (via Airflow trigger)
            topic: 'airflow-trigger-requests',
            bootStrapServers: 'kafka:9092',
            value: {
              workflowId: '${workflow.workflowId}',
              taskId: 'dp_name_parse_task',
              // Hardcoded per backend contract for Name Parse (via Airflow trigger)
              eventType: 'airflow_trigger_request',
              data: {
                dp_config: dpConfig,
              },
            },
            key: `dp-name-parse-${'${workflow.workflowId}'}`,
          },
        },
      };
    }

    // Determine output bucket/key for this service
    // Map service → output bucket names to match convention
    const output_bucket =
      snake === 'email_validation' ? 'email-validated'
      : snake === 'phone_validation' ? 'phone-validated'
      : snake === 'enrichment' ? 'enriched'
      : `${kebab}-output`;
    const output_key = `${snake}_${'${workflow.workflowId}'}.csv`;

    // Save for downstream consumers (except airflowTrigger which doesn't produce files)
    if (node.type !== 'airflowTrigger') {
      computedOutputs.set(node.id, { bucket: output_bucket, key: output_key, serviceName: snake });
    }

    // Special handling for finalize node
    if (node.type === 'finalizePipeline') {
      // Use the already-derived input bucket/key as the final output location.
      const finalBucket = input_bucket;
      const finalKey = input_key;
      // Override topic/key per sample
      return {
        name: 'finalize_pipeline',
        taskReferenceName: 'finalize_pipeline',
        type: 'KAFKA_PUBLISH',
        inputParameters: {
          kafka_request: {
            topic: 'conductor-events',
            bootStrapServers: 'kafka:9092',
            value: {
              workflowId: '${workflow.workflowId}',
              eventType: 'pipeline_completed',
              data: {
                final_bucket: finalBucket,
                final_key: finalKey,
                pipelineStage: 'completed',
                records: 1000,
              },
            },
            key: `pipeline-complete-${'${workflow.workflowId}'}`,
          },
        },
      };
    }

    // Special handling for airflow trigger overrides
    if (node.type === 'airflowTrigger') {
      return {
        name: 'trigger_airflow_dag',
        taskReferenceName: 'trigger_airflow_dag',
        type: 'KAFKA_PUBLISH',
        inputParameters: {
          kafka_request: {
            topic: 'airflow-trigger-requests',
            bootStrapServers: 'kafka:9092',
            value: {
              workflowId: '${workflow.workflowId}',
              taskId: 'airflow_trigger_task',
              eventType: 'airflow_trigger_request',
              data: {
                dag_id: node.data?.dagId || 'example_dag',
                execution_id: node.data?.executionId || 'execution',
                pipelineStage: 'airflow_processing',
              },
            },
            key: `airflow-trigger-${'${workflow.workflowId}'}`,
          },
        },
      };
    }

    const payloadData: any = {
      input_bucket,
      input_key,
      output_bucket,
      output_key,
      pipelineStage: snake,
    };
    if (previousStage) payloadData.previousStage = previousStage;
    // Include records for sample compatibility
    payloadData.records = 1000;

    const task: ConductorTask = {
      name: snake,
      taskReferenceName: snake,
      type: 'KAFKA_PUBLISH',
      inputParameters: {
        kafka_request: {
          topic: `${kebab}-requests`,
          bootStrapServers: 'kafka:9092',
          value: {
            workflowId: '${workflow.workflowId}',
            taskId: `${snake}_task`,
            eventType: `${snake}_request`,
            data: payloadData,
          },
          key: `${kebab}-${'${workflow.workflowId}'}`,
        },
      },
      // Note: sink is NOT added to KAFKA_PUBLISH tasks
      // The sink property belongs only to EVENT wait tasks, not publish tasks
      // Services publish to Kafka, and EVENT tasks wait for completion events
    };

    return task;
  }

  if (node.type === 'waitForResult') {
    return {
      name: 'wait_for_result',
      taskReferenceName: sanitizeRefName(node.data.taskName || `wait_${index}`),
      inputParameters: {
        topic: node.data.topic || 'default-results',
        workflowId: '${workflow.workflowId}',
      },
    };
  }

  return null;
}

// Resolve the canonical snake_case service name used across fields
function canonicalServiceName(type: string, node: Node): string {
  // Prefer explicit serviceName on node if provided
  if (node.data?.serviceName) return sanitizeRefName(node.data.serviceName);
  switch (type) {
    case 'nameParse':
      return 'name_parse';
    case 'emailValidation':
      return 'email_validation';
    case 'phoneValidation':
      return 'phone_validation';
    case 'enrichment':
      return 'enrichment';
    case 'finalizePipeline':
      return 'finalize_pipeline';
    case 'airflowTrigger':
      return 'airflow_processing';
    default:
      return sanitizeRefName(node.data?.label || type);
  }
}

// Utility: convert snake_case to kebab-case
function toKebab(snake: string): string {
  return snake.replace(/_/g, '-');
}

// Utility: pretty key for outputParameters (<service>_result)
function prettyServiceKey(service: string): string {
  if (service === 'airflow_processing') return 'airflow';
  if (service.endsWith('_validation')) return service.replace('_validation', '');
  return service;
}

function sanitizeRefName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Validates the generated Conductor workflow
 */
export function validateWorkflow(workflow: ConductorWorkflow): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!workflow.name || workflow.name.trim() === '') {
    errors.push('Workflow name is required');
  }

  if (!workflow.tasks || workflow.tasks.length === 0) {
    errors.push('Workflow must have at least one task');
  }

  // Check for duplicate task reference names
  const refNames = new Set<string>();
  workflow.tasks.forEach((task) => {
    if (refNames.has(task.taskReferenceName)) {
      errors.push(`Duplicate task reference name: ${task.taskReferenceName}`);
    }
    refNames.add(task.taskReferenceName);
  });

  // Validate KAFKA_PUBLISH tasks
  workflow.tasks.forEach((task) => {
    if (task.type === 'KAFKA_PUBLISH') {
      const kafkaReq = task.inputParameters?.kafka_request;
      if (!kafkaReq?.topic) {
        errors.push(`KAFKA_PUBLISH task ${task.taskReferenceName} missing topic`);
      }
      if (!kafkaReq?.bootStrapServers) {
        errors.push(
          `KAFKA_PUBLISH task ${task.taskReferenceName} missing bootStrapServers`
        );
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

