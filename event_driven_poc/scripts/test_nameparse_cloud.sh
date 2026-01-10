#!/bin/bash

function test_nameparse_cloud {

  # Base job details
  jobid="1000861509"
  metadata_url="s3://958825666686-dpservices-testing-data/conductor-poc/nameparsetest.json"
  stats_url="scp://abinitio@papdpsetld003l.intra.infousa.com//abi/log/UQU_${jobid}.2771.stats.jsonl"
  execution_id="WBNameParse"
  dagid="nua-nameparse-process-stage-v02-00-06-tiny"
  session_token="fb06b57c-e57a-48c7-971a-3835a0322f5d.D1R_-M1Gl4KXUf6QtOV__v1m3Lg"
  # Session identifier (use first arg or fallback to PID)
  session=${1:-$$}
  echo "Session ID: $session"

  # Make the jobid unique per run
  jobid="${jobid}-${session}"

  curl -X POST https://a53c6d7a-ec07-465a-9824-6cc199145a7a-vpce.c75.us-east-1.airflow.amazonaws.com:443/api/v1/dags/${dagid}/dagRuns \
       --silent \
       -b session=${session_token} \
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
test_nameparse_cloud
exit
