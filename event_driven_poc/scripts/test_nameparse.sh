#!/bin/bash

function test_nameparse {

  # Base job details
  jobid="1000861509"
  metadata_url="scp://abinitio@papdpsetld003l.intra.infousa.com//home/abinitio/UQU.devm/output/${jobid}.WBNameParse.json"
  stats_url="scp://abinitio@papdpsetld003l.intra.infousa.com//abi/log/UQU_${jobid}.2771.stats.jsonl"
  execution_id="WBNameParse"
  dagid="nua-nameparse-process-stage-v02-00-06-tiny"

  # Session identifier (use first arg or fallback to PID)
  session=${1:-$$}
  echo "Session ID: $session"

  # Make the jobid unique per run
  jobid="${jobid}-${session}"

  # Ensure the DAG is unpaused (active)
  curl -X PATCH http://papdpsaplr001l:8080/api/v1/dags/${dagid} \
       --basic --user airflow:airflow \
       -H 'Content-Type: application/json' \
       --data-binary "{\"is_paused\":false}"

  # Trigger the DAG run
  curl -X POST http://papdpsaplr001l:8080/api/v1/dags/${dagid}/dagRuns \
       --basic --user airflow:airflow \
       -H 'Content-Type: application/json' \
       --data-binary "{
         \"dag_run_id\": \"${jobid}\",
         \"conf\": {
           \"jobid\": \"${jobid}\",
           \"metadata_url\": \"${metadata_url}\",
           \"execution_id\": \"${execution_id}\",
           \"stats_url\": \"${stats_url}\"
         }
       }"

  # Return the curl exit code
  return $?
}

# Run the function
test_nameparse
exit
