#!/bin/bash

function test_nameparse {

  # Base job details
  jobid="1000861509"
  metadata_url="s3://958825666686-dpservices-testing-data/conductor-poc/1000861509.WBNameParse.json"
  stats_url="scp://abinitio@papdpsetld003l.intra.infousa.com//abi/log/UQU_${jobid}.2771.stats.jsonl"
  execution_id="WBNameParse"
  dagid="nua-nameparse-process-stage-v02-00-06-tiny"

  # Session identifier (use first arg or fallback to PID)
  session=${1:-$$}
  echo "Session ID: $session"

  # Make the jobid unique per run
  jobid="${jobid}-${session}"

  # Create output directory if it doesn't exist
  mkdir -p output
  output_file="output/${jobid}.WBNameParse.${dagid}.json"

  # AWS MWAA Configuration (can be overridden via environment variables)
  MWAA_ENV_NAME="${MWAA_ENV_NAME:-dps-airflow}"
  AWS_REGION="${AWS_REGION:-us-east-1}"
  MWAA_ENDPOINT="${MWAA_ENDPOINT:-https://a53c6d7a-ec07-465a-9824-6cc199145a7a-vpce.c75.us-east-1.airflow.amazonaws.com:443}"
  
  # Try to load session token from file if not set in environment
  if [ -z "$MWAA_SESSION_TOKEN" ] && [ -f ~/.mwaa_session_token ]; then
    MWAA_SESSION_TOKEN=$(cat ~/.mwaa_session_token 2>/dev/null | tr -d '\n')
    if [ -n "$MWAA_SESSION_TOKEN" ]; then
      echo "📝 Loaded session token from ~/.mwaa_session_token"
    fi
  fi
  
  # Check if session token is provided (alternative to AWS CLI token)
  if [ -n "$MWAA_SESSION_TOKEN" ]; then
    echo "Using session token authentication..."
    echo "Session token provided via MWAA_SESSION_TOKEN environment variable"
  else
    # Get AWS MWAA CLI token and WebServerHostname
    echo "Getting AWS MWAA CLI token for environment: ${MWAA_ENV_NAME}..."
    TOKEN_RESPONSE=$(aws mwaa create-cli-token \
      --name "${MWAA_ENV_NAME}" \
      --region "${AWS_REGION}" \
      --output json 2>/dev/null)

    if [ -z "$TOKEN_RESPONSE" ]; then
      echo "ERROR: Failed to get CLI token. Check AWS credentials and MWAA environment name."
      echo "       Current MWAA_ENV_NAME: ${MWAA_ENV_NAME}"
      echo "       Current AWS_REGION: ${AWS_REGION}"
      echo "       Alternatively, set MWAA_SESSION_TOKEN environment variable"
      return 1
    fi

    # Extract CliToken and WebServerHostname from response
    CLI_TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"CliToken": "[^"]*' | cut -d'"' -f4)
    WEB_SERVER_HOSTNAME=$(echo "$TOKEN_RESPONSE" | grep -o '"WebServerHostname": "[^"]*' | cut -d'"' -f4)

    if [ -z "$CLI_TOKEN" ] || [ -z "$WEB_SERVER_HOSTNAME" ]; then
      echo "ERROR: Failed to extract token or hostname from response."
      echo "Response: $TOKEN_RESPONSE"
      return 1
    fi

    # Use WebServerHostname if available, otherwise use provided endpoint
    if [ -n "$WEB_SERVER_HOSTNAME" ]; then
      MWAA_ENDPOINT="https://${WEB_SERVER_HOSTNAME}:443"
    fi
    
    echo "Using AWS CLI token authentication"
  fi
  
  echo "Using MWAA endpoint: ${MWAA_ENDPOINT}"

  # Trigger the DAG run
  echo "Triggering DAG run: ${jobid}"
  
  # Build curl command based on authentication method
  if [ -n "$MWAA_SESSION_TOKEN" ]; then
    # Use session token (cookie-based)
    HTTP_CODE=$(curl -X POST "${MWAA_ENDPOINT}/api/v1/dags/${dagid}/dagRuns" \
      --silent \
      --write-out "%{http_code}" \
      -b "session=${MWAA_SESSION_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"dag_run_id\":\"${jobid}\",\"conf\":{\"jobid\":\"${jobid}\",\"metadata_url\":\"${metadata_url}\",\"execution_id\":\"${execution_id}\",\"stats_url\":\"${stats_url}\"}}" \
      --output "${output_file}")
  else
    # Use AWS CLI token (Bearer token)
    HTTP_CODE=$(curl -X POST "${MWAA_ENDPOINT}/api/v1/dags/${dagid}/dagRuns" \
       --silent \
      --write-out "%{http_code}" \
      -H "Authorization: Bearer ${CLI_TOKEN}" \
      -H "Content-Type: application/json" \
       --data "{\"dag_run_id\":\"${jobid}\",\"conf\":{\"jobid\":\"${jobid}\",\"metadata_url\":\"${metadata_url}\",\"execution_id\":\"${execution_id}\",\"stats_url\":\"${stats_url}\"}}" \
      --output "${output_file}")
  fi

  # Check response and return appropriate exit code
  if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    echo "✅ DAG run triggered successfully (HTTP ${HTTP_CODE})"
    echo "Response saved to: ${output_file}"
    return 0
  else
    echo "❌ Failed to trigger DAG run (HTTP ${HTTP_CODE})"
    if [ -f "${output_file}" ]; then
      echo "Error response:"
      cat "${output_file}"
    fi
    
    # Provide helpful error messages based on HTTP code
    case "$HTTP_CODE" in
      403)
        echo ""
        echo "⚠️  Permission Denied (403)"
        echo "   Your IAM role may not have permission to trigger DAGs."
        echo "   Required IAM permissions:"
        echo "   - mwaa:CreateCliToken"
        echo "   - mwaa:GetEnvironment (to get WebServerHostname)"
        echo "   - Airflow API access (configured in MWAA environment)"
        ;;
      401)
        echo ""
        echo "⚠️  Unauthorized (401)"
        echo "   The CLI token may be invalid or expired."
        ;;
      404)
        echo ""
        echo "⚠️  Not Found (404)"
        echo "   The DAG '${dagid}' may not exist or the endpoint is incorrect."
        ;;
    esac
    
    return 1
  fi
}

# Run the function
test_nameparse
exit
