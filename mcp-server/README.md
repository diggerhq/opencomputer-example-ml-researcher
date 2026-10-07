# research-kb-mcp — dummy in-house research KB

A standalone MCP server (Streamable HTTP, stateless, official TypeScript SDK)
that stands in for an internal research knowledge base and shared experiment
registry. Ships canned research documents so the ml-researcher agent's loop
runs end to end without real infrastructure.

## Tools

| Tool | Purpose |
| --- | --- |
| `kb_list_documents` | List every KB document |
| `kb_search` | Ranked document search over the canned corpus |
| `kb_get_document` | Full text of one document |
| `baseline_model` | Deployed model, benchmark, metric, score to beat |
| `experiment_register` | Record a run (metric, config, artifact URI, notes) |
| `experiment_leaderboard` | Ranked runs vs the baseline |

The registry is in-memory and resets on restart — fine for a demo. Persist it
or point it at a real store before using it for anything serious.

## Run

```bash
npm install
npm run build
npm start          # PORT=8787; POST /mcp, GET /healthz
```

`npm run dev` runs it through tsx without a build step.

## Expose over HTTPS

OpenComputer managed MCP requires a stable HTTPS URL.

Quick throwaway endpoint:

```bash
cloudflared tunnel --url http://localhost:8787
# use https://<random>.trycloudflare.com/mcp
```

For a stable URL deploy this directory to any HTTPS host (Cloudflare Workers,
Fly, Render, a VM behind TLS, your internal platform). Then put the URL in the
agent's `opencomputer/agents/ml-researcher/mcp/knowledge-base.ts`.
