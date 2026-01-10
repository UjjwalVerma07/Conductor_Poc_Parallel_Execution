#!/bin/bash

# Environment parameters (override via service.py)
JOBID="${JOBID:-1001013123}"
METADATA_URL="${METADATA_URL:-s3://958825666686-dpservices-testing-data/conductor-poc/Reverse_Email_Json/1000860417.Reverse_Email.match.json}"
EXECUTION_ID="${EXECUTION_ID:-WBReverseEmail_Match}"
DAG_ID="${DAG_ID:-nua-match-process-stage-v01-01-04-tiny}"
MWAA_ENDPOINT="${MWAA_ENDPOINT:-https://a53c6d7a-ec07-465a-9824-6cc199145a7a-vpce.c75.us-east-1.airflow.amazonaws.com:443}"
MWAA_SESSION_TOKEN="${MWAA_SESSION_TOKEN:-a1026782-f589-4a07-89c1-b524dcdee331.3xT5sOy9IcOxdu0YuMjqpc-Z4yc}"

# Optional STATS_URL
STATS_URL="${STATS_URL:-scp://abinitio@papdpsetld003l.intra.infousa.com//abi/log/UQU_1001013123.4472.stats.jsonl}"

# Generate unique jobid
if [ -z "${SESSION_ID}" ]; then
    SESSION_ID=$(printf "%04d" $$)
fi
ORIGINAL_JOBID="${JOBID}"
JOBID="${JOBID}-${SESSION_ID}"

# Logs
echo "Triggering MATCH DAG: ${DAG_ID}" >&2
echo "Job ID: ${JOBID}" >&2 
echo "Metadata URL: ${METADATA_URL}" >&2

# Build JSON conf
CONF_JSON="{\"jobid\":\"${JOBID}\",\"metadata_url\":\"${METADATA_URL}\",\"execution_id\":\"${EXECUTION_ID}\""

if [ -n "${STATS_URL}" ]; then
  CONF_JSON="${CONF_JSON},\"stats_url\":\"${STATS_URL}\""
fi

CONF_JSON="${CONF_JSON}}"

# API call and capture response
RESPONSE=$(curl -X POST "${MWAA_ENDPOINT}/api/v1/dags/${DAG_ID}/dagRuns" \
  --silent \
  -b "session=${MWAA_SESSION_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data-binary "{
      \"dag_run_id\": \"${JOBID}\",
      \"conf\": ${CONF_JSON}
  }")

EXIT_CODE=$?

# Print JSON response
echo "${RESPONSE}"

exit $EXIT_CODE
