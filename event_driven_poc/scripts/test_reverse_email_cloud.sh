#!/bin/bash

function trigger_dag_run {
  dag_id=$1
  jobid=$2
  metadata_url=$3
  execution_id=$4
  stats_url=$5
  session_token=$6

  curl -X POST "https://a53c6d7a-ec07-465a-9824-6cc199145a7a-vpce.c75.us-east-1.airflow.amazonaws.com:443/api/v1/dags/${dag_id}/dagRuns" \
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
}

function wait_for_completion {
  dag_id=$1
  jobid=$2
  session_token=$3

  echo "Waiting for DAG: $dag_id Run ID: $jobid to complete..."
  status="running"

  while [[ "$status" == "running" || "$status" == "queued" ]]; do
    sleep 10
    status=$(curl -s -b session=${session_token} \
      "https://a53c6d7a-ec07-465a-9824-6cc199145a7a-vpce.c75.us-east-1.airflow.amazonaws.com:443/api/v1/dags/${dag_id}/dagRuns/${jobid}" \
      | jq -r '.state')

    echo "Current status: $status"
  done

  if [[ "$status" != "success" ]]; then
    echo "DAG ${dag_id} FAILED with status: ${status}"
    exit 1
  fi

  echo "DAG ${dag_id} COMPLETED SUCCESSFULLY!"
}

function test_reverse_email_cloud {

  jobid="1001013123-$$"
  session_token="95033acf-cef2-408c-9740-cd997701ce94.-nNO2hXdybJmNCrudLXXa43kfLg"

  # MATCH process values
  match_metadata_url="s3://958825666686-dpservices-testing-data/conductor-poc/Reverse_Email_Json/1000860417.Reverse_Email.match.json"
  match_execution_id="WBReverseEmail_Match"
  match_dagid="nua-match-process-stage-v01-01-04-tiny"
  match_stats_url="scp://abinitio@papdpsetld003l.intra.infousa.com//abi/log/UQU_1001013123.4472.stats.jsonl"
 
  # APPEND process values
  append_metadata_url="s3://958825666686-dpservices-testing-data/conductor-poc/Reverse_Email_Json/1000860417.Reverse_Email.append.json"
  append_execution_id="WBReverseEmail_Append"
  append_dagid="nua-append-process-stage-v01-01-02-tiny"
  append_stats_url="scp://abinitio@papdpsetld003l.intra.infousa.com//abi/log/UQU_1001013123.7582.stats.jsonl"

  echo "Triggering Match Process..."
  trigger_dag_run "$match_dagid" "$jobid" "$match_metadata_url" "$match_execution_id" "$match_stats_url" "$session_token"
  
  wait_for_completion "$match_dagid" "$jobid" "$session_token"

  echo "Triggering Append Process..."
  trigger_dag_run "$append_dagid" "$jobid" "$append_metadata_url" "$append_execution_id" "$append_stats_url" "$session_token"
}

test_reverse_email_cloud
exit
