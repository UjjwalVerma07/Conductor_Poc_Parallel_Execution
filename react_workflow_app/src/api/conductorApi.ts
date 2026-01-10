import axios from 'axios';
// Conductor API client: register, check, and trigger workflows.

// Minimal axios instance
const axiosInstance = axios.create({ timeout: 10000, validateStatus: (s) => s < 500 });

function buildUrl(conductorUrl: string, path: string): string {
  // In development, if using Vite proxy, use relative paths
  // Otherwise, use the full conductorUrl
  const base = conductorUrl && conductorUrl.trim() !== '' ? conductorUrl.replace(/\/+$/, '') : '';
  
  // If conductorUrl is localhost:8080 and we're in dev mode, use proxy (relative path)
  // This avoids CORS issues by using Vite's proxy
  if (base.includes('localhost:8080') && import.meta.env.DEV) {
    return path; // Use relative path, Vite proxy will handle it
  }
  
  return `${base}${path}`;
}

interface ConductorWorkflow {
  name: string;
  version: number;
  tasks: any[];
  [key: string]: any;
}

// Check if workflow is registered
export async function isWorkflowRegistered(
  conductorUrl: string,
  workflowName: string
): Promise<boolean> {
  const url = buildUrl(conductorUrl, `/api/metadata/workflow/${workflowName}`);
  try {
    const response = await axiosInstance.get(url, {
      validateStatus: (status) => status === 200 || status === 404, // Don't throw on 404
    });
    return response.status === 200;
  } catch (error: any) {
    // 404 means workflow doesn't exist, which is fine - return false
    if (error.response?.status === 404) {
      return false;
    }
    // For other errors, log and return false
    console.warn(`Error checking workflow registration: ${error.message}`);
    return false;
  }
}

// Register workflow metadata
export async function deployConductorWorkflow(
  conductorUrl: string,
  workflow: ConductorWorkflow
): Promise<void> {
  const url = buildUrl(conductorUrl, '/api/metadata/workflow');
  console.debug('POST', url, workflow);
  console.log(`Registering workflow "${workflow.name}" with version ${workflow.version}`);
  
  const response = await axiosInstance.post(url, workflow, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (response.status === 200 || response.status === 204) {
    console.log(`✅ Workflow registered successfully with version ${workflow.version}`);
    return;
  }
  if (response.status === 409) {
    // Version already exists - this shouldn't happen with timestamp versions, but handle it
    console.warn(`Version ${workflow.version} already exists. Using existing version.`);
    // Still return success as the workflow exists
    return;
  }
  if (response.status >= 400) {
    console.error('Failed to register workflow:', response.data);
    throw new Error(response.data?.message || `Failed with ${response.status}`);
  }
}

// Trigger a workflow instance
export async function triggerConductorWorkflow(
  conductorUrl: string,
  workflowName: string,
  inputParams: any = {},
  version?: number
): Promise<string> {
  // If version is provided, trigger that specific version
  const url = version 
    ? buildUrl(conductorUrl, `/api/workflow/${workflowName}?version=${version}`)
    : buildUrl(conductorUrl, `/api/workflow/${workflowName}`);
  console.debug('POST', url, inputParams);
  const response = await axiosInstance.post(url, inputParams, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (response.status === 200 || response.status === 201) {
    // Conductor returns workflow ID as a string (may be quoted)
    const workflowId = typeof response.data === 'string' 
      ? response.data.trim().replace(/^"|"$/g, '') 
      : response.data?.workflowId || response.data;
    return workflowId;
  }
  
  if (response.status >= 400) {
    throw new Error(response.data?.message || `Failed to trigger workflow: ${response.status}`);
  }
  
  throw new Error('Unexpected response from Conductor');
}

export async function postWorkflowToFastAPI(
  conductorUrl: string,
  payload: {
    workflow: any;
    minio_input_uri: string;
    workflow_id?: string;
    trigger_conductor?: boolean;
  }
) {
  const { workflow, minio_input_uri, workflow_id, trigger_conductor = true } = payload;

  console.log("Preparing to send workflow to FastAPI...", { workflow, minio_input_uri, workflow_id, trigger_conductor });

  if (!workflow) throw new Error("Workflow object is required and cannot be undefined or null");
  if (!minio_input_uri) throw new Error("minio_input_uri is required and cannot be undefined or null");

  let workflowObj = workflow;
  if (typeof workflow === "string") {
    try {
      workflowObj = JSON.parse(workflow);
    } catch {
      throw new Error("workflow is a string but not valid JSON");
    }
  }

  const bodyPayload = {
    workflow: workflowObj,
    minio_input_uri,
    workflow_id,
    trigger_conductor,
  };

  console.log("Sending payload to FastAPI:", bodyPayload);

  try {
    const response = await fetch(`${conductorUrl}/workflow/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`FastAPI Error: ${errText}`);
    }

    const data = await response.json();
    console.log("Response from FastAPI:", data);
    return data;
  } catch (err: any) {
    console.error("Failed to call FastAPI:", err.message);
    throw err;
  }
}

// Rerun an existing workflow instance
export async function rerunConductorWorkflowInstance(
  conductorUrl: string,
  workflowInstanceId: string,
  options?: {
    reRunFromFailedTask?: boolean;
    taskRefName?: string | null;
    resetTasks?: string[];
  }
): Promise<void> {
  const url = buildUrl(conductorUrl, `/api/workflow/${workflowInstanceId}/rerun`);
  const body = {
    workflowId: workflowInstanceId,
    reRunFromFailedTask: options?.reRunFromFailedTask ?? false,
    taskRefName: options?.taskRefName ?? null,
    resetTasks: options?.resetTasks ?? [],
  };

  console.debug('POST', url, body);
  const response = await axiosInstance.post(url, body, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (response.status >= 400) {
    throw new Error(response.data?.message || `Failed to rerun workflow: ${response.status}`);
  }
}

