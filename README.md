# OpenComputer example: ML Researcher

An [OpenComputer](https://opencomputer.dev) managed agent that runs a real ML
research loop:

1. **Reads an in-house MCP knowledge base** — program briefs, prior experiment
   results, dataset notes, evaluation pitfalls — attached with `useMcpServer`.
2. **Launches training experiments on AWS and GCP** — the agent gets a real
   shell (`sandbox_exec`) in its own sandbox computer and drives the `aws` and
   `gcloud` CLIs (bootstrap, auth, job submit, poll, teardown) following the
   bundled runbook skills.
3. **Benchmarks candidates and iterates** — code-defined `benchmark_*` tools
   score artifacts on the trusted harness, `experiment_register` writes every
   run to the shared registry, and the agent iterates until a candidate beats
   the deployed baseline on the promotion metric.

## Layout

```text
opencomputer/
  agents/ml-researcher/
    agent.ts                  # system prompt + capability wiring
    opencomputer.toml         # committed agent identity
    mcp/knowledge-base.ts     # defineMcpServer — edit this URL after step 1
    tools/benchmark.ts        # benchmark_suites / benchmark_run (simulated harness)
    tools/cloud.ts            # cloud_preflight credential check
    skills/
      experiment-loop/        # the research loop, end to end
      aws-experiments/        # aws CLI install/auth/submit/poll/teardown runbook
      gcp-experiments/        # gcloud CLI install/auth/Vertex job runbook
mcp-server/                   # standalone dummy research-KB MCP server
```

## 1. Deploy the dummy knowledge-base MCP

Managed MCP servers must be reachable over a stable **HTTPS** URL. The bundled
`mcp-server/` implements the in-house KB + experiment registry with the
official MCP SDK (Streamable HTTP, stateless).

For a quick throwaway endpoint:

```bash
cd mcp-server && npm install && npm start          # listens on :8787
cloudflared tunnel --url http://localhost:8787     # prints https://*.trycloudflare.com
```

or deploy `mcp-server/` to any HTTPS host (Cloudflare Workers, Fly, a VM
behind TLS, your internal platform — whatever your in-house MCP uses).

Then set the URL as a **literal** in
[`opencomputer/agents/ml-researcher/mcp/knowledge-base.ts`](opencomputer/agents/ml-researcher/mcp/knowledge-base.ts)
— `defineMcpServer` collects URLs at build time, so it cannot read an env var:

```ts
url: "https://<your-tunnel-or-host>/mcp",
```

## 2. Configure cloud credentials (optional per provider)

The agent's sandbox shell inherits [agent runtime variables], so the `aws`
and `gcloud` CLIs authenticate exactly as they would on a workstation. Set only
the providers you want — `cloud_preflight` tells the agent which are usable
and it plans around the rest.

```bash
npx --package @opencomputer/cli opencomputer env set AWS_ACCESS_KEY_ID --value-stdin
npx --package @opencomputer/cli opencomputer env set AWS_SECRET_ACCESS_KEY --value-stdin
npx --package @opencomputer/cli opencomputer env set AWS_DEFAULT_REGION --value-stdin   # e.g. us-east-1
npx --package @opencomputer/cli opencomputer env set GCP_SERVICE_ACCOUNT_JSON --value-stdin
npx --package @opencomputer/cli opencomputer env set GCP_PROJECT_ID --value-stdin
```

(each value is piped on stdin, e.g. `printf %s "$VALUE" | opencomputer env set NAME --value-stdin`)

## 3. Deploy and run

```bash
npm install
npm run opencomputer -- login
npm run opencomputer -- link --create-project ml-researcher
npm run deploy
npm run session
```

The template's first-run prompt does a safe connectivity pass: KB lookup via
the MCP tools, `cloud_preflight`, then a proposed experiment round — it never
launches cloud jobs without approval.

## What to change for your real setup

- **`mcp/knowledge-base.ts`** — point `defineMcpServer` at your real MCP and,
  if it needs auth, add a `connection` with `bearer(useSecret(...))` (see
  [MCP servers](https://docs.opencomputer.dev/agents/mcp)).
- **`tools/benchmark.ts`** — the suites and `benchmark_run`'s deterministic
  simulator are the seam: swap `run()` for a call to your real harness and keep
  the schemas.
- **Skills** — the AWS/GCP runbooks use SageMaker/Batch and Vertex custom jobs;
  adapt the submit/poll blocks to your training stack. The CLI-auth sections
  work as-is.
- **`mcp-server/`** — a throwaway. Replace it with your real KB MCP, or keep
  the tool surface and point it at your real store.

## Notes

- `sandbox_exec` commands die at the call timeout; the runbooks therefore
  submit async cloud jobs and poll with short status calls.
- The agent is instructed to tag every resource `program=triage-v5`, early-kill
  underwater runs, and stop compute at the end of a round.
- No credentials, account IDs, or internal URLs belong in this repo — set them
  as runtime variables or secrets on your project.
