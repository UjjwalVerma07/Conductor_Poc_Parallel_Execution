from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Optional
from ingestion_service import IngestionService
from conductor_api import deployConductorWorkflow, triggerConductorWorkflow
import os
import time
import tempfile
import subprocess
from s3_utils import S3Manager
from config import Config
from dotenv import load_dotenv
from fastapi import WebSocket
import json 
from minio_utils import MinIOManager
import logging
import time
active_ws_connections=set()

load_dotenv()

minio_manager=MinIOManager()


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


from contextlib import asynccontextmanager
import threading
import asyncio
from contextlib import asynccontextmanager
import threading
import asyncio

@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()

    # Start Kafka consumer in background thread
    consumer_thread = threading.Thread(target=start_kafka_consumer, args=(loop,), daemon=True)
    consumer_thread.start()
    print("Kafka consumer thread started")

    yield  # app runs here

    print("Shutting down...")



app = FastAPI(title="Ingestion Service", version="1.1.0",lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


CONDUCTOR_URL = os.getenv("CONDUCTOR_URL", "http://conductor-server-event:8080")

ingestion_service = IngestionService()


class WorkflowPayload(BaseModel):
    workflow: Dict[str, Any]
    workflow_id: Optional[str] = None
    trigger_conductor: Optional[bool] = True

def extract_tasks_xml(tasks:list)->dict:

    extracted_xmls={}
    for task in tasks:
        task_type=task.get("type")
        task_name=task.get("name")
        if task_type in ["KAFKA_PUBLISH"]:
            dp_config=(
                task.get("inputParameters")
                    .get("kafka_request")
                    .get("value")
                    .get("data")
                    .get("dp_config")
            )
            if dp_config:
                extracted_xmls[task_name]=dp_config
    return extracted_xmls



import json
from xml.dom.minidom import parseString

def normalize_input_string(raw):

    try:
        return json.loads(raw)  
    except Exception:
        return raw.replace('\\"', '"') 


def handle_newline_logic(xml_string: str) -> str:

    temp = xml_string
    result = ""
    i = 0

    while i < len(temp):
        if temp[i:i+2] == "\\n":
            context = temp[max(0, i-300):i] 
            
            if ("<dps:delim>" in context or
                "<dps:report" in context or
                "</dps:report" in context or
                "<dps:report_assignment" in context or
                "report." in context):
                result += "\\n"  
            else:
                result += "\\n"  
            i+=2
        else:
            result += temp[i]
            i += 1
    return result
   


def pretty_format_xml(xml_str, indent='    '):

    dom = parseString(xml_str)
    pretty = dom.toprettyxml(indent=indent)
    lines = [line for line in pretty.splitlines() if line.strip() != '']
    return '\n'.join(lines)


def convert_escaped_xml_to_pretty(raw_input):

    normalized = normalize_input_string(raw_input).strip()
    normalized = handle_newline_logic(normalized)
    pretty = pretty_format_xml(normalized)
    return pretty


def modify_email_hygiene_report_delimiter(json_data: dict) -> dict:

    if "service" in json_data and "report" in json_data["service"]:
        report = json_data["service"]["report"]
        if "record" in report and isinstance(report["record"], list):
            for record_field in report["record"]:
                if "delimiter" in record_field and record_field["delimiter"] == "\n":
                    record_field["delimiter"] = "\\n"
    return json_data


def xml_to_json(extracted_xmls:dict)->dict:
    uploaded_json={}

    # ALLOWED_S3_BUCKET = "958825666686-dpservices-testing-data"
    # ALLOWED_S3_PREFIX = "conductor-poc"
    s3_manager=S3Manager()
    s3_prefix=Config.S3_PREFIX
    s3_bucket=Config.S3_BUCKET
    
    

    for task_name,xml_string in extracted_xmls.items():
        print(f"Processing the service: {task_name}")

        with tempfile.NamedTemporaryFile(delete=False,suffix=".xml") as xml_file:
            pretty_xml=convert_escaped_xml_to_pretty(xml_string)
            xml_file.write(pretty_xml.encode("utf-8"))
            xml_path=xml_file.name

        
        with tempfile.NamedTemporaryFile(delete=False,suffix=".json") as json_file:
            json_path=json_file.name
        
         #Execution id can be WBNameParse , WBEmailHygiene
         #task->execution_id
        execution_id_mapping={
            "dp_email_hygiene":"WBEmailHygiene",
            "dp_name_parse":"WBNameParse"
        }
        execution_id=execution_id_mapping[task_name]
        #dpservices.bin usage
        cmd=[
            "/app/dpservices.bin",
            "-generate-dps-json",
            "-metadata_url",xml_path,
            "-output_url",json_path,
            "-execution_id",execution_id
        ]
        result=subprocess.run(cmd,capture_output=True,text=True)
        print(f"Result: {result}")
        if result.returncode!=0:
            raise RuntimeError(f"dpservices.bin failed:{result.stderr}")
        print(f"Generated Json for {task_name}:{json_path}")


       
        if task_name == "dp_email_hygiene":
            with open(json_path, 'r', encoding='utf-8') as f:
                json_data = json.load(f)
            modified_json = modify_email_hygiene_report_delimiter(json_data)
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(modified_json, f, indent=2, ensure_ascii=False)
            print(f"Modified report delimiter for {task_name}")
        
        s3_inputkey=f"{s3_prefix}/{task_name}.json"
        s3_manager.upload_file(json_path,s3_inputkey)
        print(f"Uploaded to S3 : {s3_inputkey}")
        uploaded_json[task_name]=s3_inputkey

    return uploaded_json
     
        
@app.post("/workflow/deploy")
async def deploy_workflow(payload: WorkflowPayload):
    try:

        minio_input_uri = "minio://raw-data/first_10_entries.in"
        print("Using hardcoded MinIO URI:", minio_input_uri)
        
        workflows=payload.workflow
        tasks=workflows.get("tasks",[])
        extracted_xmls=extract_tasks_xml(tasks) 
        print(f"Extracting XMLs for each corresponding tasks : {extracted_xmls}")

        uploaded_jsons=xml_to_json(extracted_xmls)
        print(uploaded_jsons)
   
        service_results,_ = ingestion_service.execute_service_chain(
            workflow_json=payload.workflow,
            minio_input_uri=minio_input_uri,
            workflow_id=payload.workflow_id
        )


        updated_workflow = ingestion_service.update_workflow_template(
            workflow_json=payload.workflow,
            service_results=service_results
        )

      
        if "version" not in updated_workflow:
            updated_workflow["version"] = int(time.time())

        workflow_instance_id = None
        if payload.trigger_conductor:
       
            deployConductorWorkflow(CONDUCTOR_URL, updated_workflow)

  
            workflow_instance_id = triggerConductorWorkflow(
                CONDUCTOR_URL,
                updated_workflow.get("name"),
                inputParams={},
                version=updated_workflow.get("version")
            )

        first_service_name = list(service_results.keys())[0] if service_results else None
        first_result = service_results.get(first_service_name, {})

        return {
            "runId": first_result.get("run_id"),
            "s3_input_uri": first_result.get("s3_input_uri"),
            "s3_output_uri": first_result.get("s3_output_uri"),
            "s3_report_uri": first_result.get("s3_report_uri"),
            "updated_json_uri": first_result.get("updated_json_uri"),
            "updated_json_s3_key": first_result.get("updated_json_s3_key"),
            "workflow_instance_id": workflow_instance_id,
            "message": (
                "Workflow deployed and triggered successfully"
                if workflow_instance_id else "Workflow deployed without triggering Conductor"
            ),
            
        }

    except Exception as e:
        import traceback
        print("Error deploying workflow:", str(e))
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to deploy workflow: {str(e)}"
        )

from fastapi import WebSocket, WebSocketDisconnect
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_ws_connections.add(websocket)
    print(f"WebSocket connected: {websocket.client}")

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        print(f"WebSocket disconnected: {websocket.client}")
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        active_ws_connections.remove(websocket)



import asyncio

async def push_to_ui(message: dict):
    """
    Sends real-time updates to all active WebSocket connections.
    """
    if not active_ws_connections:
        return
    data = json.dumps(message)
    for ws in active_ws_connections.copy():
        try:
            await ws.send_text(data)
        except Exception as e:
            print("Failed to send WS message:", e)
            active_ws_connections.remove(ws)

from kafka import KafkaConsumer
import threading
from fastapi import HTTPException
import requests
KAFKA_BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP', 'localhost:9092')
TOPIC_NAME=os.getenv("STATS_TOPIC","conductor-events")
CONDUCTOR_BASE_URL="http://conductor-server:8080/api"


def process_retry_full(loop, workflow_id, event):
    import time, requests, asyncio
    from fastapi import HTTPException

    time.sleep(5)
    logger.info("Wait for 5 seconds till results load")
    
    # Get the workflow execution data
    wf_url = f"{CONDUCTOR_BASE_URL}/workflow/{workflow_id}"
    wf_resp = requests.get(wf_url)
    if wf_resp.status_code != 200:
        raise HTTPException(status_code=404, detail="Workflow Not Found")
    
    wf_data = wf_resp.json()
    tasks = wf_data.get("tasks", [])
    
    if not tasks:
        raise Exception("No tasks found in workflow execution")
    
    # Find first failed task
    failed_index = next((i for i, t in enumerate(tasks) if t["status"] == "FAILED"), None)
    if failed_index is None:
        logger.info("No failed tasks - nothing to rerun")
        return None
    
    failed_task = tasks[failed_index]
    failed_ref = failed_task["referenceTaskName"]
    failed_type = failed_task["taskType"]
    logger.info(f"Failed Task: {failed_task['referenceTaskName']}, Type: {failed_type}")
    
    # Determine start_index for rerun
    start_index = failed_index - 1 if failed_type == "EVENT" or failed_ref.startswith("wait_for_") else failed_index
    # start_index = failed_index
    start_index = max(0, start_index)
    start_task = tasks[start_index]
    start_ref = start_task["referenceTaskName"]
    logger.info(f"Restarting from task: {start_ref}")
    
    # Reset from the start task onward using the execution order.
    # For EVENT wait tasks, this points at the preceding KAFKA_PUBLISH task
    # so the publish + wait pair reruns together instead of the whole flow.
    reset_task_refs = [t["referenceTaskName"] for t in tasks[start_index:]]
    logger.info(f"Tasks to reset (including unexecuted): {reset_task_refs}")

    
    # Notify UI
    info_data = {
        "rerun_url": f"{CONDUCTOR_BASE_URL}/workflow/{workflow_id}/rerun",
        "CONDUCTOR_BASE_URL": CONDUCTOR_BASE_URL
    }
    asyncio.run_coroutine_threadsafe(push_to_ui(info_data), loop)
    
    # Conductor rerun API expects `reRunFromTaskRefName` (not referenceTaskName).
    # Include taskId for compatibility, but the refName is the primary selector.
    payload = {
        "workflowId": workflow_id,
        "reRunFromTaskRefName": start_ref,
        "reRunFromTaskId": start_task.get("taskId"),
        "resetTasks": reset_task_refs
    }

    
    logger.info(f"Payload Received To Retry the Task is : {payload}")
    logger.info("Sending Retry request to Conductor...")
    logger.info(f"Now Retrying the Workflow")
    rerun_url = f"{CONDUCTOR_BASE_URL}/workflow/{workflow_id}/rerun"
    info_data={
        "retry_url":rerun_url,
        "payload":payload
    }
    logger.info(f"Info Data Received is : {info_data}")
    logger.info(f"Data Sending To the Frontend to Retry Through UI.....")
    asyncio.run_coroutine_threadsafe(
        push_to_ui(info_data),
        loop
    )

    # logger.info(f"Now Retrying the Workflow")
    # rerun_url = f"{CONDUCTOR_BASE_URL}/workflow/{workflow_id}/rerun"
    # rerun_response = requests.post(rerun_url, json=payload)
    
    # if rerun_response.status_code >= 300:
    #     raise Exception(f"Rerun failed: {rerun_response.status_code} - {rerun_response.text}")
    
    # print("Workflow rerun triggered successfully")
    # return rerun_response
    return



from fastapi import FastAPI, HTTPException, Request
import requests

CONDUCTOR_BASE_URL = "http://conductor-server-event:8080/api"

@app.post("/retry-workflow")
async def retry_workflow(request: Request):
    payload = await request.json()
    
    rerun_url = payload.get("rerun_url")
    if not rerun_url:
        raise HTTPException(status_code=400, detail="rerun_url is required in payload")
    
    try:
        # Forward the retry request directly to Conductor
        response = requests.post(rerun_url, json=payload.get("payload", {}))
        
        if response.status_code >= 300:
            raise HTTPException(status_code=response.status_code, detail=response.text)
        
        # If response is empty, just return a success message
        try:
            return response.json()
        except ValueError:
            return {"message": "Workflow rerun triggered successfully"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



def start_kafka_consumer(loop):
    consumer = KafkaConsumer(
        "conductor-events",
        bootstrap_servers=KAFKA_BOOTSTRAP,
        value_deserializer=lambda m: json.loads(m.decode("utf-8")),
        auto_offset_reset="latest",
        group_id="ingestion-service-group",
    )

    print("Kafka Consumer started, listening for stats events...")

    for msg in consumer:
        event = msg.value
        stats_url = event.get("data", {}).get("stats_url")
        workflow_id = event.get("workflowId")
        status=event.get("data",{}).get("status",'')
        task_id=event.get("taskId",'')
        if status=="failed":
            # process_retry(loop,workflow_id,event)
            process_retry_full(loop,workflow_id,event)
        logger.info(f"The Status Received is : {status}")
        logger.info(f"Workflow Id Received is : {workflow_id}")
        logger.info(f"Stats Url Received is : {stats_url}")
        

        if stats_url:
            print(f"Received Stats URL: {stats_url}")

            # Download file from MinIO
            with tempfile.NamedTemporaryFile(delete=False, suffix=".jsonl") as stats_file:
                minio_manager.download_file(stats_url, stats_file.name)
                stats_file_path = stats_file.name

            with open(stats_file_path, "r") as f:
                stats_data = f.read()
                logger.info(f"Stats Data Received is : {stats_data}")

            # Push to UI via WebSocket using existing event loop
            if loop and active_ws_connections:
                asyncio.run_coroutine_threadsafe(
                    push_to_ui({
                        "workflow_id": workflow_id,
                        "taskId":task_id,
                        "stats_url": stats_url,
                        "content": stats_data
                    }),
                    loop
                )

