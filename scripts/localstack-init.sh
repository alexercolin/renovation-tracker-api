#!/usr/bin/env bash
set -euo pipefail

DLQ_URL="$(awslocal sqs create-queue --queue-name reports-dlq --query QueueUrl --output text)"
DLQ_ARN="$(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)"

ATTRIBUTES="$(python3 - "$DLQ_ARN" <<'PY'
import json, sys
dlq_arn = sys.argv[1]
print(json.dumps({
    "VisibilityTimeout": "120",
    "RedrivePolicy": json.dumps({"deadLetterTargetArn": dlq_arn, "maxReceiveCount": "3"}),
}))
PY
)"
awslocal sqs create-queue --queue-name reports --attributes "$ATTRIBUTES" >/dev/null

awslocal s3 mb s3://reports >/dev/null 2>&1 || true

echo "localstack init: queues 'reports' (+dlq) and bucket 'reports' ready"
