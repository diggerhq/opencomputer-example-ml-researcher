import { defineTool } from "@opencomputer/agent";

/**
 * Reports which cloud providers have credentials configured as agent runtime
 * variables. Returns only presence/absence — never credential values. Run it
 * before planning cloud work so the agent proposes experiments only on
 * providers that are actually reachable.
 *
 * Variable names use the EXP_ prefix because the platform reserves AWS_* —
 * the sandbox runtime injects its own AWS_REGION/AWS_* host variables, and
 * runtime-variable names starting with AWS_ are rejected. EXP_AWS_* values
 * are exported as AWS_* inside each sandbox_exec command (see the
 * aws-experiments skill). Without EXP_AWS_*, the aws CLI may still
 * authenticate via the sandbox's inherited host IAM role — always verify the
 * account with `aws sts get-caller-identity` before launching anything.
 */
export const cloudPreflight = defineTool({
  name: "cloud_preflight",
  description:
    "Check which cloud providers are configured for this deployment. Returns availability and the missing variable names for AWS (aws CLI, EXP_AWS_* variables) and GCP (gcloud CLI). Never prints credential values. Run before planning experiments so you only propose providers that can actually run jobs.",
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
      "EXP_AWS_ACCESS_KEY_ID",
      "EXP_AWS_SECRET_ACCESS_KEY",
      "EXP_AWS_DEFAULT_REGION",
    ].filter((name) => !present(name));
    const aws = {
      configured: awsMissing.length === 0,
      missing: awsMissing,
      ...(present("EXP_AWS_DEFAULT_REGION")
        ? { region: process.env.EXP_AWS_DEFAULT_REGION! }
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
        "AWS_* names are reserved by the platform, so AWS creds live in EXP_AWS_* variables and are " +
        "exported as AWS_* per command. If EXP_AWS_* is unset, the aws CLI can still authenticate via " +
        "the sandbox's inherited host role — that is the platform's account, not yours: verify " +
        "aws sts get-caller-identity and never submit jobs to an account you did not intend. " +
        "A provider marked unconfigured cannot launch jobs — " +
        "ask the operator to set the listed variables instead of attempting the CLI.",
    };
  },
});
