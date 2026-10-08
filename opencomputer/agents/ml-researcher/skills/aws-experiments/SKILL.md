---
name: aws-experiments
description: Runbook for launching training experiments on AWS through the aws CLI inside sandbox_exec — install, auth check, job submit/poll/teardown patterns. Use whenever an experiment targets AWS.
---

# AWS experiments

Everything runs through `sandbox_exec`. Commands are killed at the call's
timeout — submit async cloud jobs and poll with short status commands instead
of watching a long-running process. Writes that complete before the timeout
persist in the workspace and on AWS.

## 1. Install the CLI (once per sandbox)

```bash
command -v aws >/dev/null 2>&1 || {
  arch="$(uname -m)"
  [ "$arch" = "aarch64" ] && aws_arch="aarch64" || aws_arch="x86_64"
  command -v unzip >/dev/null 2>&1 || dnf install -y unzip
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${aws_arch}.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install --update
  rm -rf /tmp/aws /tmp/awscliv2.zip
}
aws --version
```

If the install fails because the OS lacks `dnf`/`unzip`, fall back to
`pip3 install awscli` or `python3 -m pip install awscli`.

## 2. Verify credentials

AWS credentials arrive as the EXP_AWS_* runtime variables — `AWS_*` names are
reserved by the platform, which injects its own AWS_REGION / Lambda host
variables into the sandbox. Export the mapping inside the same command as each
CLI call (sandbox_exec does not persist exports between calls), and never
print the values:

```bash
export AWS_ACCESS_KEY_ID="$EXP_AWS_ACCESS_KEY_ID" \
       AWS_SECRET_ACCESS_KEY="$EXP_AWS_SECRET_ACCESS_KEY" \
       AWS_DEFAULT_REGION="${EXP_AWS_DEFAULT_REGION:-us-east-1}"
[ -n "$EXP_AWS_SESSION_TOKEN" ] && export AWS_SESSION_TOKEN="$EXP_AWS_SESSION_TOKEN"
aws sts get-caller-identity
```

If EXP_AWS_* is unset, `aws` still authenticates via the sandbox's inherited
host IAM role — that is the platform's account, not yours. Always check the
account id in the identity output before submitting anything; never launch
jobs into an account you were not pointed at. If the identity call fails,
credentials are missing or expired — report it and stop; do not retry in a
loop or hunt for values.

## 3. Submit a training job

Two working patterns; prefer the one matching your team's footprint.

SageMaker training job:

```bash
aws sagemaker create-training-job \
  --training-job-name "triage-v5-${RUN_NAME}" \
  --role-arn "$SAGEMAKER_EXECUTION_ROLE_ARN" \
  --algorithm-specification TrainingImage="$TRAINING_IMAGE" TrainingInputMode=File \
  --input-data-config "[{\"ChannelName\":\"train\",\"DataSource\":{\"S3DataSource\":{\"S3DataType\":\"S3Prefix\",\"S3Uri\":\"s3://${BUCKET}/triage-v5/data/\"}}}]" \
  --output-data-config "S3OutputPath=s3://${BUCKET}/triage-v5/${RUN_NAME}/" \
  --resource-config InstanceType=ml.g5.xlarge,InstanceCount=1,VolumeSizeInGB=50 \
  --stopping-condition MaxRuntimeInSeconds=3600 \
  --enable-managed-spot-training \
  --checkpoint-config "S3Uri=s3://${BUCKET}/triage-v5/${RUN_NAME}/checkpoints/" \
  --tags "Key=program,Value=triage-v5" "Key=run,Value=${RUN_NAME}" "Key=owner,Value=ml-researcher"
```

AWS Batch (for a containerized trainer):

```bash
aws batch submit-job \
  --job-name "triage-v5-${RUN_NAME}" \
  --job-queue "$BATCH_JOB_QUEUE" \
  --job-definition "$BATCH_JOB_DEFINITION" \
  --container-overrides "environment=[{name=RUN_CONFIG,value=${CONFIG_JSON}}]" \
  --tags "program=triage-v5,run=${RUN_NAME},owner=ml-researcher"
```

Record the job name/ARN and artifact prefix the moment the submit succeeds.

## 4. Poll

```bash
aws sagemaker describe-training-job --training-job-name "triage-v5-${RUN_NAME}" \
  --query '{status:TrainingJobStatus,secondary:SecondaryStatus,billable:BillableTimeInSeconds}'
# or: aws batch describe-jobs --jobs "$JOB_ID" --query 'jobs[0].status'
```

Poll every few minutes in separate calls. Early-kill per the experiment
policy if the val metric is underwater mid-run:

```bash
aws sagemaker stop-training-job --training-job-name "triage-v5-${RUN_NAME}"
```

## 5. Collect and tear down

```bash
aws s3 ls "s3://${BUCKET}/triage-v5/${RUN_NAME}/"
aws s3 cp "s3://${BUCKET}/triage-v5/${RUN_NAME}/model.tar.gz" /workspace/artifacts/ --no-progress  # only if needed locally
```

The artifact URI (`s3://.../model.tar.gz`) is what `benchmark_run` consumes.
Teardown at end of round: confirm no running jobs remain
(`aws sagemaker list-training-jobs --status-equals InProgress`), and delete any
scratch EC2/Batch infrastructure you created outside managed services.
