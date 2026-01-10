import React, { useCallback, useEffect, useState } from 'react';
import { postWorkflowToFastAPI } from '../api/conductorApi';
// WorkflowDesigner: minimal canvas + palette to compose service nodes.
// Only the first Email node accepts a file/key input; all other details are derived.
import ReactFlow, {
  addEdge,
  Background,
  Connection,
  Controls,
  Edge,
  Node,
  useEdgesState,
  useNodesState,
  Panel,
  MiniMap,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box,
  Drawer,
  Stack,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Tooltip,
} from '@mui/material';
import { Download, Menu as MenuIcon, Code, Brightness4, Brightness7 } from '@mui/icons-material';
import KafkaPublishNode from './nodes/KafkaPublishNode';
import WaitForResultNode from './nodes/WaitForResultNode';
import EventWaitNode from './nodes/EventWaitNode';
import EmailHygieneNode from './nodes/EmailHygieneNode';
import NameParseNode from './nodes/NameParseNode';
import NodePalette from './NodePalette';
import { convertToConductorJSON } from '../utils/conductorConverter';
import { deployConductorWorkflow, isWorkflowRegistered, triggerConductorWorkflow, rerunConductorWorkflowInstance } from '../api/conductorApi';
import ReactJson from 'react-json-view';

// Map service types to ReactFlow node components
const nodeTypes = {
  airflowTrigger: KafkaPublishNode,
  emailValidation: KafkaPublishNode,
  phoneValidation: KafkaPublishNode,
  enrichment: KafkaPublishNode,
  nameParse: NameParseNode,
  dpEmailHygiene: EmailHygieneNode,
  finalizePipeline: KafkaPublishNode,
  eventWait: EventWaitNode,
  waitForResult: WaitForResultNode,
};

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

type Props = { themeMode?: 'light' | 'dark'; onToggleTheme?: () => void };

function WorkflowDesigner({ themeMode = 'light', onToggleTheme }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);
  const [workflowName, setWorkflowName] = useState('poc_workflow');
  const [workflowDescription, setWorkflowDescription] = useState('Event-driven pipeline with direct Conductor-microservice integration');
  const [ownerEmail, setOwnerEmail] = useState('team@data-axle.com');
  const [conductorUrl, setConductorUrl] = useState('http://localhost:8080');
  const [generatedJson, setGeneratedJson] = useState<any>(null);
  const [postStatus, setPostStatus] = useState<{
    type: 'success' | 'error' | 'info' | null;
    message: string;
  }>({ type: null, message: '' });
  const [lastWorkflowInstanceId, setLastWorkflowInstanceId] = useState<string | null>(null);

  // WebSocket: listen for stats / retry events from backend (per-service DP stats/logs)
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws');

    ws.onopen = () => {
      console.log('✅ WebSocket connected');
    };

    ws.onmessage = (event) => {
      console.log('📩 WebSocket message received:', event.data);

      try {
        const parsed = JSON.parse(event.data);
        console.log('Parsed WS data:', parsed);

        const workflowId = parsed?.workflow_id as string | undefined;
        const taskId = parsed?.taskId as string | undefined;
        const content: string | undefined = parsed?.content;
        const retryUrl: string | undefined = parsed?.retry_url;
        const retryPayload: any = parsed?.payload;

        // Retry payloads: attach retry info to the matching service node based on reRunFromTaskRefName
        if (retryUrl && retryPayload && retryPayload.reRunFromTaskRefName) {
          const refName: string = retryPayload.reRunFromTaskRefName;
          setNodes((prevNodes) =>
            prevNodes.map((node) => {
              let serviceRefName: string | undefined;
              if (node.type === 'dpEmailHygiene') {
                serviceRefName = 'dp_email_hygiene';
              } else if (node.type === 'nameParse') {
                serviceRefName = 'dp_name_parse';
              } else if (node.type === 'emailValidation') {
                serviceRefName = 'email_validation';
              } else if (node.type === 'phoneValidation') {
                serviceRefName = 'phone_validation';
              } else if (node.type === 'enrichment') {
                serviceRefName = 'enrichment';
              }

              const matches = serviceRefName && serviceRefName === refName;
              if (matches) {
                return {
                  ...node,
                  data: {
                    ...node.data,
                    retry: {
                      retryUrl,
                      payload: retryPayload,
                    },
                    // Mark this node as failed so the UI can highlight it and surface Retry
                    status: 'failed',
                  },
                };
              }
              return node;
            })
          );
          return;
        }

        // Stats payloads: attach stats to matching DP node based on taskId
        if (content && taskId) {
          setNodes((prevNodes) =>
            prevNodes.map((node) => {
              let expectedTaskId: string | undefined;
              if (node.type === 'dpEmailHygiene') {
                expectedTaskId = 'dp_email_hygiene_task';
              } else if (node.type === 'nameParse') {
                expectedTaskId = 'dp_name_parse_task';
              }

              if (expectedTaskId && expectedTaskId === taskId) {
                const anyData: any = node.data || {};
                const existingRetry = anyData.retry;
                const nextStatus =
                  existingRetry && anyData.status === 'failed' ? 'failed' : 'success';
                return {
                  ...node,
                  data: {
                    ...node.data,
                    stats: {
                      taskId,
                      workflowId: workflowId || '',
                      content,
                    },
                    // If we already saw a retry for this node, keep it as failed; otherwise mark success.
                    status: nextStatus,
                  },
                };
              }

              return node;
            })
          );
        }
      } catch (err) {
        console.log('Raw WS string:', event.data);
      }
    };

    ws.onerror = (err) => {
      console.error('❌ WebSocket error:', err);
    };

    ws.onclose = () => {
      console.log('🔌 WebSocket disconnected');
    };

    return () => ws.close();
  }, [setNodes]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (!type) return;

      const position = {
        x: event.clientX - 250,
        y: event.clientY - 100,
      };

      const newNode: Node = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data: getDefaultNodeData(type),
      };

      // For this POC, EVENT wait tasks are derived implicitly in the converter.
      // We only add the visible service node to the canvas; no explicit wait node is rendered.
      setNodes((nds) => nds.concat(newNode));
    },
    [setNodes, setEdges]
  );

  // Default data for nodes pulled from a JSON registry to minimize hardcoding and scale easily.
  const defaultsRegistry: Record<string, any> = {
    airflowTrigger: {
      label: 'Airflow Trigger',
      serviceName: 'airflow_processing',
      dagId: 'nua-nameparse-process-stage-v02-00-06-tiny',
      executionId: 'WBNameParse',
    },
    emailValidation: {
      label: 'Email Validation',
      serviceName: 'email_validation',
      simpleInputMode: true,
      inputKey: 'customer_data_sample.csv',
      inputBucket: 'raw-data',
    },
    phoneValidation: {
      label: 'Phone Validation',
      serviceName: 'phone_validation',
    },
    enrichment: {
      label: 'Enrichment',
      serviceName: 'enrichment',
    },
    nameParse: {
      label: 'Name Parse',
      serviceName: 'name_parse',
      status: 'idle',
    },
    dpEmailHygiene: {
      label: 'DP Email Hygiene',
      serviceName: 'dp_email_hygiene',
      inputUri: 's3://958825666686-dpservices-testing-data/conductor-poc/1000861642.out',
      outputUri: 's3://958825666686-dpservices-testing-data/conductor-poc/EmailHygiene/1000876402/1000876411.out',
      reportUri: 's3://958825666686-dpservices-testing-data/conductor-poc/EmailHygiene/1000876402/1000876411.report.eh',
      generateReport: false,
      emailSourceField: 'EE_Email_Addr80',
      selectedLayoutId: '1000876411',
      status: 'idle',
    },
    finalizePipeline: {
      label: 'Finalize Pipeline',
      serviceName: 'finalize_pipeline',
    },
    eventWait: {
      label: 'Wait Event',
    },
    waitForResult: {
      label: 'Wait for Result',
      topic: 'stage1-results',
      timeout: 120,
    },
  };
  const getDefaultNodeData = (type: string) => defaultsRegistry[type] ?? { label: 'Node' };

  const handleExportJSON = () => {
    const json = convertToConductorJSON(nodes, edges, workflowName);
    // Apply additional metadata
    json.description = workflowDescription;
    json.ownerEmail = ownerEmail;
    setGeneratedJson(json);
    setJsonDialogOpen(true);
  };

  const handleDownloadJSON = () => {
    const json = convertToConductorJSON(nodes, edges, workflowName);
    // Apply additional metadata
    json.description = workflowDescription;
    json.ownerEmail = ownerEmail;
    const blob = new Blob([JSON.stringify(json, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${workflowName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // const handlePostWorkflow = async () => {
  //   try {
  //     const json = convertToConductorJSON(nodes, edges, workflowName);
  //     // Apply additional metadata
  //     json.description = workflowDescription;
  //     json.ownerEmail = ownerEmail;
      
  //     // Debug: Log the JSON being sent to Conductor
  //     console.log('JSON being sent to Conductor:', JSON.stringify(json, null, 2));
  //     console.log('Tasks in JSON (order):', json.tasks.map((t: any, idx: number) => ({ 
  //       index: idx, 
  //       name: t.name, 
  //       type: t.type 
  //     })));

  //     // Step 1: Always register/update the workflow with new version
  //     // The timestamp-based version ensures a new version is created each time
  //     setPostStatus({ type: 'info', message: 'Registering workflow with new version...' });
  //     await deployConductorWorkflow(conductorUrl, json);
  //     setPostStatus({ type: 'info', message: `Workflow registered (version ${json.version}). Triggering...` });

  //     // Step 3: Trigger the workflow with the specific version we just registered
  //     const workflowId = await triggerConductorWorkflow(conductorUrl, workflowName, {}, json.version);
      
  //     const workflowUrl = `${conductorUrl.replace('/api', '')}/workflow/${workflowId}`;
  //     setPostStatus({
  //       type: 'success',
  //       message: `Workflow triggered successfully! ID: ${workflowId}`,
  //     });
      
  //     // Log the workflow URL for easy access
  //     console.log(`Workflow URL: ${workflowUrl}`);
  //   } catch (error: any) {
  //     setPostStatus({
  //       type: 'error',
  //       message: error.message || 'Operation failed',
  //     });
  //   }
  // };


  const handlePostWorkflow = async () => {
    try {
      if (nodes.length === 0) {
        setPostStatus({ type: 'error', message: 'No nodes in workflow to submit.' });
        return;
      }

      // Mark DP service nodes as running while workflow executes
      setNodes((prev) =>
        prev.map((n) =>
          n.type === 'dpEmailHygiene' || n.type === 'nameParse'
            ? { ...n, data: { ...n.data, status: 'running' } }
            : n
        )
      );

      // Convert canvas nodes/edges to Conductor JSON
      const workflowJson = convertToConductorJSON(nodes, edges, workflowName);
      workflowJson.description = workflowDescription;
      workflowJson.ownerEmail = ownerEmail;

      // Compute minio_input_uri:
      // 1) If Email node exists, build from bucket/key.
      // 2) Else if DP Email Hygiene exists, convert its inputUri (s3:// → minio://).
      let minio_input_uri: string | undefined = undefined;
      const emailNode = nodes.find((n) => n.type === 'emailValidation');
      if (emailNode?.data?.inputKey) {
        minio_input_uri = `minio://${emailNode.data.inputBucket}/${emailNode.data.inputKey}`;
      } else {
        const dpNode = nodes.find((n) => n.type === 'dpEmailHygiene');
        const dpInput = dpNode?.data?.inputUri as string | undefined;
        if (dpInput && typeof dpInput === 'string') {
          minio_input_uri = dpInput.startsWith('s3://')
            ? dpInput.replace(/^s3:\/\//, 'minio://')
            : dpInput;
        }
      }

      if (!minio_input_uri) {
        setPostStatus({ type: 'error', message: 'Cannot find MinIO input URI from Email node.' });
        return;
      }

      setPostStatus({ type: 'info', message: 'Submitting workflow to FastAPI...' });

      // Call FastAPI
      const result = await postWorkflowToFastAPI('http://localhost:8000', {
        workflow: workflowJson,
        minio_input_uri,
        workflow_id: workflowName,
        trigger_conductor: true,
      });

      const instanceId: string | undefined =
        result?.workflow_instance_id || result?.workflowId || result?.workflow_id;
      if (instanceId) {
        setLastWorkflowInstanceId(instanceId);
      }

      setPostStatus({
        type: 'success',
        message: `Workflow deployed successfully! Workflow ID: ${result.workflow_instance_id}`,
      });

      console.log('Workflow submission result:', result);
    } catch (error: any) {
      console.error('Error posting workflow:', error);
      setPostStatus({
        type: 'error',
        message: error.message || 'Failed to submit workflow',
      });
    }
  };





const clearCanvas = () => {
  setNodes([]);
  setEdges([]);
};

const handleRerunWorkflow = async () => {
  try {
    if (!lastWorkflowInstanceId) {
      setPostStatus({ type: 'error', message: 'No workflow instance ID available to rerun.' });
      return;
    }

    setPostStatus({ type: 'info', message: `Re-running workflow ${lastWorkflowInstanceId}...` });

    await rerunConductorWorkflowInstance(conductorUrl, lastWorkflowInstanceId, {
      reRunFromFailedTask: false,
      taskRefName: null,
      resetTasks: [],
    });

    setPostStatus({
      type: 'success',
      message: `Re-run triggered successfully for Workflow ID: ${lastWorkflowInstanceId}`,
    });
  } catch (error: any) {
    console.error('Error re-running workflow:', error);
    setPostStatus({
      type: 'error',
      message: error.message || 'Failed to re-run workflow',
    });
  }
};

  // Removed sample template loader to keep repo minimal and focused.

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* App Bar */}
      <AppBar position="static">
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            onClick={() => setDrawerOpen(!drawerOpen)}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Conductor Workflow Designer - {nodes.length} nodes, {edges.length}{' '}
            connections
          </Typography>
          <Stack direction="row" spacing={1}>
            <Tooltip title={themeMode === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}>
              <IconButton color="inherit" onClick={onToggleTheme}>
                {themeMode === 'light' ? <Brightness4 /> : <Brightness7 />}
              </IconButton>
            </Tooltip>
            <Button
              color="inherit"
              startIcon={<Code />}
              onClick={handleExportJSON}
            >
              View JSON
            </Button>
            <Button
              color="inherit"
              startIcon={<Download />}
              onClick={handleDownloadJSON}
            >
              Download
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>

      {/* Main Content */}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Side Panel */}
        <Drawer
          variant="persistent"
          open={drawerOpen}
          sx={{
            width: 300,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: 300,
              boxSizing: 'border-box',
              position: 'relative',
            },
          }}
        >
          <Box sx={{ p: 2, overflow: 'auto' }}>
            <Typography variant="h6" gutterBottom>
              Node Palette
            </Typography>
            <NodePalette />

            <Typography variant="h6" sx={{ mt: 3 }} gutterBottom>
              Workflow Settings
            </Typography>
            <Stack spacing={1}>
              <TextField
                fullWidth
                label="Workflow Name"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                size="small"
              />
              <TextField
                fullWidth
                label="Description"
                value={workflowDescription}
                onChange={(e) => setWorkflowDescription(e.target.value)}
                size="small"
                multiline
                rows={2}
              />
              <TextField
                fullWidth
                label="Owner Email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                size="small"
                type="email"
              />
              <TextField
                fullWidth
                label="Conductor URL"
                value={conductorUrl}
                onChange={(e) => setConductorUrl(e.target.value)}
                size="small"
                placeholder="http://localhost:8080"
              />
              <Button
                variant="contained"
                fullWidth
                onClick={handlePostWorkflow}
                disabled={nodes.length === 0 || !conductorUrl}
              >
                Submit Workflow
              </Button>
              <Button
                variant="outlined"
                fullWidth
                onClick={handleRerunWorkflow}
                disabled={!lastWorkflowInstanceId || !conductorUrl}
              >
                Re-run Workflow
              </Button>
              {postStatus.type && (
                <Alert severity={postStatus.type}>
                  {postStatus.message}
                </Alert>
              )}
              <Button
                variant="outlined"
                fullWidth
                color="error"
                onClick={clearCanvas}
              >
                Clear Canvas
              </Button>
            </Stack>

            <Box sx={{ mt: 3 }}>
              <Typography variant="caption" color="text.secondary">
                Drag nodes onto the canvas and connect them to build your
                workflow
              </Typography>
            </Box>
          </Box>
        </Drawer>

        {/* ReactFlow Canvas */}
        <Box sx={{ flex: 1, position: 'relative' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
            <Panel position="top-right">
              <Stack direction="row" spacing={1}>
                <Chip label={`Email: ${nodes.filter((n) => n.type === 'emailValidation').length}`} color="primary" size="small" />
                <Chip label={`Phone: ${nodes.filter((n) => n.type === 'phoneValidation').length}`} color="primary" size="small" />
                <Chip label={`Enrich: ${nodes.filter((n) => n.type === 'enrichment').length}`} color="primary" size="small" />
                <Chip label={`Finalize: ${nodes.filter((n) => n.type === 'finalizePipeline').length}`} color="primary" size="small" />
                <Chip label={`Wait: ${nodes.filter((n) => n.type === 'waitForResult').length}`} color="secondary" size="small" />
              </Stack>
            </Panel>
          </ReactFlow>
        </Box>
      </Box>

      {/* JSON View Dialog */}
      <Dialog
        open={jsonDialogOpen}
        onClose={() => setJsonDialogOpen(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>Generated Conductor JSON</DialogTitle>
        <DialogContent>
          {generatedJson && (
            <ReactJson
              src={generatedJson}
              theme="monokai"
              collapsed={2}
              displayDataTypes={false}
              displayObjectSize={false}
              enableClipboard
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setJsonDialogOpen(false)}>Close</Button>
          <Button onClick={handleDownloadJSON} variant="contained">
            Download JSON
          </Button>
        </DialogActions>
      </Dialog>

      {/* Minimal POC: No deploy dialog */}
    </Box>
  );
}

export default WorkflowDesigner;

