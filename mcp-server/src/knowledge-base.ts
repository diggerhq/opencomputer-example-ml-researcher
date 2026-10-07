/**
 * Dummy in-house research knowledge base. Replace these canned documents with
 * a real store (search index, database, document service) when wiring the
 * example to your internal MCP.
 */

export interface KbDocument {
  id: string;
  title: string;
  collection: string;
  updated: string;
  body: string;
  keywords: string[];
}

export const BASELINE_MODEL = {
  name: "support-triage-v4",
  description:
    "Production ticket-triage classifier: a 0.6B encoder fine-tuned on the triage-v3 corpus.",
  benchmark: "triage-bench-v2",
  metric: "macro_f1",
  score: 0.764,
  evaluated: "2026-09-18",
};

export const KB_DOCUMENTS: KbDocument[] = [
  {
    id: "kb-001",
    title: "Program brief: beat support-triage-v4",
    collection: "program",
    updated: "2026-10-01",
    keywords: ["brief", "goal", "baseline", "triage", "classifier"],
    body: `Goal: ship a ticket-triage model that beats support-triage-v4 on triage-bench-v2 (macro_f1, hard split).

Current production: support-triage-v4, macro_f1 0.764 (see baseline_model tool).

Rules of the program:
- Every candidate is scored on triage-bench-v2 with the SAME harness; numbers from any other eval are not comparable.
- Promotion requires >= +0.01 macro_f1 over baseline AND a passing spot-check on 50 hand-labeled tickets.
- Keep cloud spend under $40/experiment. Use spot/preemptible capacity where possible.
- Register every run with experiment_register, including failures — negative results steer the next round.`,
  },
  {
    id: "kb-002",
    title: "Prior fine-tuning results (LoRA sweep, Q3)",
    collection: "experiments",
    updated: "2026-09-22",
    keywords: ["lora", "hyperparameters", "learning-rate", "fine-tuning", "sweep"],
    body: `Last quarter's sweep on the same corpus, same harness:

| config | macro_f1 |
|---|---|
| LoRA r=16, alpha=32, lr=2e-4, cosine | 0.782 (+0.018) — best so far |
| LoRA r=64, alpha=64, lr=2e-4 | 0.771 — overfit after epoch 2 |
| LoRA r=8, alpha=16, lr=5e-4 | 0.768 — underfit |
| Full FT lr=1e-5 | 0.759 — catastrophic forgetting on rare intents |

Notes:
- lr=2e-4 with 3 epochs and cosine decay was the stable recipe.
- Warmup 3% helped rare-intent classes.
- Nothing has beaten 0.782 yet; that is the number to beat, not 0.764, if you reuse this line of attack.`,
  },
  {
    id: "kb-003",
    title: "Dataset notes: triage-v3 corpus",
    collection: "data",
    updated: "2026-09-25",
    keywords: ["dataset", "corpus", "labels", "dedup", "data-quality"],
    body: `The triage-v3 corpus is 84k labeled tickets across 12 intents.

Known issues and what worked:
- ~9% near-duplicates from the auto-reply import; deduping them was worth +0.011 macro_f1 in isolation.
- "billing" and "invoice-dispute" intents are confused by annotators ~18% of the time. A two-pass label audit on those classes only costs a few hours and previously gained +0.007.
- Long tickets (>2k tokens) are truncated mid-conversation; join + summarise first, or the truncation artefact teaches the model to fire on the greeting.
- Stratified splits only — random splits leak near-duplicates across train/eval.`,
  },
  {
    id: "kb-004",
    title: "Evaluation pitfalls and the triage-bench-v2 harness",
    collection: "evaluation",
    updated: "2026-09-28",
    keywords: ["benchmark", "evaluation", "harness", "leakage", "metrics"],
    body: `triage-bench-v2 is the only trusted eval. It has two splits: standard and hard.

- Always report the HARD split; the standard split is saturated (everyone scores ~0.95).
- Never tune on the eval set. Two teams already shipped regressions this way.
- The harness normalizes labels before scoring; export predictions as the raw intent string, not the display name.
- macro_f1 is the promotion metric; per-class recall on "outage" and "security" must not regress more than 0.02.
- A run is only reproducible if you record: dataset snapshot id, config, seed, and the artifact URI.`,
  },
  {
    id: "kb-005",
    title: "Training infrastructure notes (AWS + GCP)",
    collection: "infrastructure",
    updated: "2026-09-30",
    keywords: ["aws", "gcp", "sagemaker", "vertex", "spot", "gpu", "infrastructure"],
    body: `Both clouds work for this size of job; use whichever the team account has quota on.

AWS:
- ml.g5.xlarge (1x A10G) trains this model in ~35 min for ~$1.20 spot.
- SageMaker Training jobs or a plain EC2 spot + remote script both fine; tag everything "program=triage-v5".
- Artifacts convention: s3://<team-bucket>/triage-v5/<run-name>/model.tar.gz

GCP:
- Vertex AI custom job, 1x L4 in us-central1, ~40 min.
- Artifacts convention: gs://<team-bucket>/triage-v5/<run-name>/
- Preemptible is fine; checkpoint every 200 steps to the bucket so a preemption loses <=200 steps.

Always write the checkpoint prefix INTO the experiment record so the leaderboard can trace artifacts.`,
  },
  {
    id: "kb-006",
    title: "Experiment policy and compute budget",
    collection: "program",
    updated: "2026-10-02",
    keywords: ["policy", "budget", "search", "approval", "experiments"],
    body: `Experiment policy:
- Rounds of 3-5 configs, never a wider sweep without a human's say-so.
- Kill a run early if val metric at 40% of training is below the floor of the previous round.
- Every cloud resource gets tagged/labeled with program=triage-v5, run=<run-name>, owner=ml-researcher.
- Stop all compute when the round ends; orphaned GPU instances were our biggest cost leak.
- Anything that could spend >$40, touch production data, or write to a shared bucket prefix outside triage-v5 needs explicit human approval first.`,
  },
];

export interface ExperimentRecord {
  run_name: string;
  provider: string;
  metric_name: string;
  metric_value: number;
  config_summary: string;
  artifact_uri?: string;
  notes?: string;
  registered_at: string;
}

const experiments: ExperimentRecord[] = [
  {
    run_name: "lora-r16-lr2e-4-q3",
    provider: "aws",
    metric_name: "macro_f1",
    metric_value: 0.782,
    config_summary: "LoRA r=16 alpha=32 lr=2e-4 cosine 3ep, deduped corpus",
    artifact_uri: "s3://team-bucket/triage-v5/lora-r16-lr2e-4-q3/model.tar.gz",
    notes: "Best prior result; see kb-002.",
    registered_at: "2026-09-22T14:11:00.000Z",
  },
];

export function listDocuments(): Array<Omit<KbDocument, "body">> {
  return KB_DOCUMENTS.map(({ body: _body, ...meta }) => meta);
}

export function getDocument(id: string): KbDocument | undefined {
  return KB_DOCUMENTS.find((doc) => doc.id === id);
}

export function searchDocuments(query: string, limit = 5): KbDocument[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1);
  const scored = KB_DOCUMENTS.map((doc) => {
    const haystack = `${doc.title} ${doc.keywords.join(" ")} ${doc.body}`.toLowerCase();
    const score = terms.reduce(
      (total, term) => total + (haystack.split(term).length - 1),
      0,
    );
    return { doc, score };
  })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, Math.min(limit, 10))).map(({ doc }) => doc);
}

export function registerExperiment(record: Omit<ExperimentRecord, "registered_at">) {
  const entry: ExperimentRecord = {
    ...record,
    registered_at: new Date().toISOString(),
  };
  experiments.push(entry);
  return entry;
}

export function leaderboard(metric = "macro_f1") {
  const rows = experiments
    .filter((row) => row.metric_name === metric)
    .sort((a, b) => b.metric_value - a.metric_value);
  return {
    metric,
    baseline: { model: BASELINE_MODEL.name, value: BASELINE_MODEL.score },
    entries: rows.map((row, index) => ({
      rank: index + 1,
      beats_baseline: row.metric_value > BASELINE_MODEL.score,
      ...row,
    })),
  };
}
