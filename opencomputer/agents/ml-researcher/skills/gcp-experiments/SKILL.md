---
name: gcp-experiments
description: Runbook for launching training experiments on GCP through the gcloud CLI inside sandbox_exec — install, service-account auth, Vertex AI custom job submit/poll/teardown. Use whenever an experiment targets GCP.
---

# GCP experiments

Everything runs through `sandbox_exec`. Commands are killed at the call's
timeout — submit async cloud jobs and poll with short status commands instead
of watching a long-running process.

## 1. Install the CLI (once per sandbox)

```bash
command -v gcloud >/dev/null 2>&1 || {
  arch="$(uname -m)"
  [ "$arch" = "aarch64" ] && gc_arch="arm" || gc_arch="x86_64"
  command -v python3 >/dev/null 2>&1 && command -v tar >/dev/null 2>&1 || \
    dnf install -y python3 tar gzip
  # Recent SDKs require Python >= 3.10; on Python 3.9 sandboxes pin a 3.9-compatible release.
  py_minor="$(python3 -c 'import sys; print(sys.version_info.minor)' 2>/dev/null || echo 0)"
  sdk_url="https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-${gc_arch}.tar.gz"
  [ "$py_minor" -lt 10 ] && \
    sdk_url="https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-399.0.0-linux-${gc_arch}.tar.gz"
  curl -fsSL "$sdk_url" -o /tmp/gcloud.tar.gz
  tar -xzf /tmp/gcloud.tar.gz -C /opt
  /opt/google-cloud-sdk/install.sh --quiet --usage-reporting=false
  ln -sf /opt/google-cloud-sdk/bin/gcloud /usr/local/bin/gcloud
  ln -sf /opt/google-cloud-sdk/bin/gsutil /usr/local/bin/gsutil
  rm -f /tmp/gcloud.tar.gz
}
gcloud --version
```

## 2. Authenticate

The service-account JSON arrives as the `GCP_SERVICE_ACCOUNT_JSON` runtime
variable (never print it). Materialize it into a key file and activate:

```bash
printf '%s' "$GCP_SERVICE_ACCOUNT_JSON" > /tmp/gcp-sa.json && chmod 600 /tmp/gcp-sa.json
gcloud auth activate-service-account --key-file=/tmp/gcp-sa.json --quiet
gcloud config set project "$GCP_PROJECT_ID" --quiet
gcloud auth list --filter=status:ACTIVE --format='value(account)'
```

If `GCP_SERVICE_ACCOUNT_JSON` is unset or auth fails, report it and stop — do
not retry in a loop or hunt for values.

## 3. Submit a Vertex AI custom job

Write the job spec once, submit by file:

```bash
cat > /tmp/job-${RUN_NAME}.json <<EOF
{
  "displayName": "triage-v5-${RUN_NAME}",
  "jobSpec": {
    "workerPoolSpecs": [{
      "machineSpec": { "machineType": "g2-standard-4", "acceleratorType": "NVIDIA_L4", "acceleratorCount": 1 },
      "replicaCount": 1,
      "containerSpec": {
        "imageUri": "${TRAINING_IMAGE}",
        "args": ["--config", "${CONFIG_JSON}", "--output", "gs://${BUCKET}/triage-v5/${RUN_NAME}/"]
      }
    }],
    "scheduling": { "strategy": "SPOT", "timeout": "3600s" },
    "baseOutputDirectory": { "outputUriPrefix": "gs://${BUCKET}/triage-v5/${RUN_NAME}/" }
  },
  "labels": { "program": "triage-v5", "run": "${RUN_NAME}", "owner": "ml-researcher" }
}
EOF
gcloud ai custom-jobs create --region="${GCP_REGION:-us-central1}" --display-name="triage-v5-${RUN_NAME}" --config=/tmp/job-${RUN_NAME}.json
```

Checkpoint inside the job every ~200 steps to the same bucket prefix so a
preemption loses little work. Record the job's numeric resource name.

## 4. Poll

```bash
gcloud ai custom-jobs describe "$JOB_ID" --region="${GCP_REGION:-us-central1}" \
  --format='value(state)'
```

Poll every few minutes in separate calls. Early-kill per the experiment
policy if the val metric is underwater mid-run:

```bash
gcloud ai custom-jobs cancel "$JOB_ID" --region="${GCP_REGION:-us-central1}"
```

## 5. Collect and tear down

```bash
gsutil ls "gs://${BUCKET}/triage-v5/${RUN_NAME}/"
```

The artifact URI (`gs://.../model/` or the packaged file) is what
`benchmark_run` consumes. Teardown at end of round: confirm no running jobs
remain (`gcloud ai custom-jobs list --region=... --filter='state=JOB_STATE_RUNNING'`),
and remove the key file (`rm -f /tmp/gcp-sa.json`) plus any scratch resources
you created.
