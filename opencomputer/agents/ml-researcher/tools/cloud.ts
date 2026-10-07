import { defineTool } from "@opencomputer/agent";

/**
 * Reports which cloud providers have credentials configured as agent runtime
 * variables. Returns only presence/absence — never credential values. Run it
 * before planning cloud work so the agent proposes experiments only on
 * providers that are actually reachable.
 */
export const cloudPreflight = defineTool({
  name: "cloud_preflight",
  description:
    "Check which cloud providers are configured for this deployment. Returns availability and the missing variable names for AWS (aws CLI) and GCP (gcloud CLI). Never prints credential values. Run before planning experiments so you only propose providers that can actually run jobs.",
  input: { type: "object", properties: {}, additionalProperties: false },
  output: {
    type: "object",
    properties: {
      aws: {
        type: "object",
        properties: {
          configured: { type: "boolean" },
          missing: { type: "array", items: { type: "string" } },
          region: { type: "string" },
        },
        required: ["configured", "missing"],
        additionalProperties: false,
      },
      gcp: {
        type: "object",
        properties: {
          configured: { type: "boolean" },
          missing: { type: "array", items: { type: "string" } },
          project: { type: "string" },
        },
        required: ["configured", "missing"],
        additionalProperties: false,
      },
      note: { type: "string" },
    },
    required: ["aws", "gcp", "note"],
    additionalProperties: false,
  },
  async run() {
    const present = (name: string): boolean =>
      Boolean(process.env[name] && process.env[name]!.trim().length > 0);

    const awsMissing = [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_DEFAULT_REGION",
    ].filter((name) => !present(name));
    const aws = {
      configured: awsMissing.length === 0,
      missing: awsMissing,
      ...(present("AWS_DEFAULT_REGION")
        ? { region: process.env.AWS_DEFAULT_REGION! }
        : {}),
    };

    const gcpMissing = [
      "GCP_SERVICE_ACCOUNT_JSON",
      "GCP_PROJECT_ID",
    ].filter((name) => !present(name));
    const gcp = {
      configured: gcpMissing.length === 0,
      missing: gcpMissing,
      ...(present("GCP_PROJECT_ID") ? { project: process.env.GCP_PROJECT_ID! } : {}),
    };

    return {
      aws,
      gcp,
      note:
        "Credentials reach the sandbox through agent runtime variables (opencomputer env set). " +
        "Sandbox shell commands inherit them. A provider marked unconfigured cannot launch jobs — " +
        "ask the operator to set the listed variables instead of attempting the CLI.",
    };
  },
});
