import requests
from typing import Dict, Any

def build_url(conductor_url: str, path: str) -> str:
    base = conductor_url.rstrip('/')
    return f"{base}{path}"

def deployConductorWorkflow(conductor_url: str, workflow: Dict[str, Any]) -> None:
    url = build_url(conductor_url, "/api/metadata/workflow")
    response = requests.post(url, json=workflow)
    if response.status_code not in (200, 204):
        raise Exception(f"Failed to deploy workflow: {response.text}")

def triggerConductorWorkflow(
    conductor_url: str,
    workflow_name: str,
    inputParams: Dict[str, Any] = {},
    version: int = None
) -> str:
    url = build_url(conductor_url, f"/api/workflow/{workflow_name}")
    if version:
        url += f"?version={version}"

    response = requests.post(url, json=inputParams)

    if response.status_code not in (200, 201):
        raise Exception(f"Failed to trigger workflow: {response.text}")

 
    print("Raw Response:", response.text)

    try:
      
        data = response.json()
        workflow_id = data.get("workflowId") or data

    except ValueError:
      
        cleaned = response.text.strip().replace('"', '').replace("'", "")
        workflow_id = cleaned

    return str(workflow_id)
