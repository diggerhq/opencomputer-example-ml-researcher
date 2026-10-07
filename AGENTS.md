# ML Researcher example

This repository is a standalone OpenComputer example. Keep it focused on one
flow: research the in-house MCP knowledge base, launch training experiments on
AWS and GCP through their CLIs in `sandbox_exec`, benchmark artifacts, and
iterate to beat the deployed baseline.

## Rules

- Never commit credentials, cloud account IDs, internal URLs, or generated
  artifacts. The MCP URL in `mcp/knowledge-base.ts` is the single line a user
  edits after deploying `mcp-server/`.
- Keep `defineMcpServer` URLs HTTPS literals — the CLI collects them at build
  time and env-based URLs do not work.
- `sandbox_exec` terminates descendants when a command ends; keep cloud work in
  submit/poll form, never persistent watchers.
- `tools/benchmark.ts` is a deterministic stand-in for a real harness. Keep its
  simulated scoring clearly marked and deterministic on the same inputs.
- The mcp-server/ fixture must remain stateless and dependency-light; keep the
  canned KB plausible and free of real company data.
- Verify with `npm run build` (tsc), `npm run opencomputer -- template validate .`,
  and `cd mcp-server && npm run build`.
