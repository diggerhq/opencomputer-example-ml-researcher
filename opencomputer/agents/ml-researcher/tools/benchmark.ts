import { createHash } from "node:crypto";
import { defineTool } from "@opencomputer/agent";

/**
 * Stand-in for the team's benchmark harness.
 *
 * `benchmark_suites` and `benchmark_run` are deterministic simulators: the
 * score is a stable function of the artifact + config + seed, so the example
 * workflow (research → train → evaluate → compare) runs end to end without a
 * real harness. To wire the real harness, replace `run()` with a call to your
 * evaluation service (or a shell invocation of your eval CLI) and keep
 * the schemas — the agent's procedure does not change.
 */

const SUITES = [
  {
    name: "triage-bench-v2",
    split: "hard",
    metric: "macro_f1",
    baseline_model: "support-triage-v4",
    baseline_score: 0.764,
    promotion_margin: 0.01,
    guard_metrics: [
      { name: "recall.outage", baseline: 0.79, max_regression: 0.02 },
      { name: "recall.security", baseline: 0.82, max_regression: 0.02 },
    ],
    artifact_uri_schemes: ["s3://", "gs://", "local://", "harness://"],
    note: "Only the hard split counts for promotion; the standard split is saturated.",
  },
];

function digest(parts: string): number {
  const hex = createHash("sha256").update(parts).digest("hex");
  return parseInt(hex.slice(0, 12), 16) / 0xffffffffffff;
}

function simulatedScore(input: {
  suite: string;
  artifact_uri: string;
  config_summary: string;
  seed: number;
}): { value: number; recalls: Record<string, number> } {
  const key = `${input.suite}|${input.artifact_uri}|${input.config_summary}|${input.seed}`;
  const value = 0.7 + digest(`f1|${key}`) * 0.11; // 0.700–0.810 band
  const recalls: Record<string, number> = {};
  for (const guard of SUITES[0]!.guard_metrics) {
    recalls[guard.name] = guard.baseline - 0.04 + digest(`${guard.name}|${key}`) * 0.08;
  }
  return {
    value: Math.round(value * 10000) / 10000,
    recalls: Object.fromEntries(
      Object.entries(recalls).map(([name, v]) => [name, Math.round(v * 10000) / 10000]),
    ),
  };
}

export const benchmarkSuites = defineTool({
  name: "benchmark_suites",
  description:
    "List the trusted benchmark suites: metric, production baseline score, promotion margin, and guard-metric constraints. Run this before evaluating so results are compared against the right baseline.",
  input: { type: "object", properties: {}, additionalProperties: false },
  async run() {
    return { suites: SUITES };
  },
});

export const benchmarkRun = defineTool({
  name: "benchmark_run",
  description:
    "Evaluate a trained model artifact on a benchmark suite and return the promotion metric, the delta vs baseline, and guard-metric results. Only artifacts produced by a completed training run are valid inputs — never evaluate a hypothetical model.",
  input: {
    type: "object",
    properties: {
      suite: {
        type: "string",
        description: "Suite name from benchmark_suites, e.g. 'triage-bench-v2'",
      },
      artifact_uri: {
        type: "string",
        description: "Model artifact location produced by the training run (s3://, gs://, local://, or harness:// URI)",
      },
      config_summary: {
        type: "string",
        description: "One-line training config used for this artifact; recorded with the score",
      },
      seed: {
        type: "integer",
        description: "Eval seed for reproducibility (default 0)",
      },
    },
    required: ["suite", "artifact_uri", "config_summary"],
    additionalProperties: false,
  },
  output: {
    type: "object",
    properties: {
      run_id: { type: "string" },
      suite: { type: "string" },
      metric: { type: "string" },
      value: { type: "number" },
      baseline: { type: "number" },
      delta_vs_baseline: { type: "number" },
      promoted: { type: "boolean" },
      guard_metrics: { type: "object", additionalProperties: { type: "number" } },
      guard_failures: { type: "array", items: { type: "string" } },
    },
    required: ["run_id", "suite", "metric", "value", "baseline", "delta_vs_baseline", "promoted", "guard_metrics", "guard_failures"],
    additionalProperties: false,
  },
  async run({ input }) {
    const suite = SUITES.find((candidate) => candidate.name === input.suite);
    if (!suite) {
      throw new Error(
        `Unknown suite ${JSON.stringify(input.suite)}. Call benchmark_suites for valid names.`,
      );
    }
    const artifact = String(input.artifact_uri);
    if (!suite.artifact_uri_schemes.some((scheme) => artifact.startsWith(scheme))) {
      throw new Error(
        `artifact_uri must start with one of ${suite.artifact_uri_schemes.join(", ")} — ` +
          "the harness only reads artifacts produced by a training run.",
      );
    }
    const seed = typeof input.seed === "number" ? input.seed : 0;
    const { value, recalls } = simulatedScore({
      suite: suite.name,
      artifact_uri: artifact,
      config_summary: String(input.config_summary),
      seed,
    });
    const delta = Math.round((value - suite.baseline_score) * 10000) / 10000;
    const guardFailures = suite.guard_metrics
      .filter((guard) => (recalls[guard.name] ?? 0) < guard.baseline - guard.max_regression)
      .map(
        (guard) =>
          `${guard.name} ${(recalls[guard.name] ?? 0).toFixed(4)} regressed past ` +
          `${(guard.baseline - guard.max_regression).toFixed(2)} (baseline ${guard.baseline})`,
      );
    return {
      run_id: createHash("sha256")
        .update(`${suite.name}|${artifact}|${seed}`)
        .digest("hex")
        .slice(0, 12),
      suite: suite.name,
      metric: suite.metric,
      value,
      baseline: suite.baseline_score,
      delta_vs_baseline: delta,
      promoted: delta >= suite.promotion_margin && guardFailures.length === 0,
      guard_metrics: recalls,
      guard_failures: guardFailures,
    };
  },
});
