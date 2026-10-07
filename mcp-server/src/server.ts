import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  BASELINE_MODEL,
  getDocument,
  leaderboard,
  listDocuments,
  registerExperiment,
  searchDocuments,
} from "./knowledge-base.js";

const PORT = Number(process.env.PORT ?? 8787);

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "research-kb-mcp", version: "0.1.0" },
    { capabilities: { logging: {} } },
  );

  server.registerTool(
    "kb_list_documents",
    {
      title: "List KB documents",
      description:
        "List every document in the research knowledge base (id, title, collection, keywords). Call kb_get_document for a document's full text.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify({ documents: listDocuments() }, null, 2) }],
    }),
  );

  server.registerTool(
    "kb_search",
    {
      title: "Search the research KB",
      description:
        "Search the in-house research knowledge base. Returns ranked documents with their full text — briefs, prior experiment results, dataset notes, evaluation pitfalls, and infra guidance for the model program.",
      inputSchema: {
        query: z.string().describe("Free-text query, e.g. 'lora hyperparameters' or 'benchmark harness'"),
        limit: z.number().int().min(1).max(10).optional().describe("Max documents to return (default 5)"),
      },
    },
    async ({ query, limit }) => {
      const hits = searchDocuments(query, limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { query, results: hits.map((doc) => ({ id: doc.id, title: doc.title, collection: doc.collection, body: doc.body })) },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "kb_get_document",
    {
      title: "Read a KB document",
      description: "Return the full text of one knowledge-base document by id (e.g. 'kb-003').",
      inputSchema: {
        id: z.string().describe("Document id from kb_list_documents or kb_search"),
      },
    },
    async ({ id }) => {
      const doc = getDocument(id);
      if (!doc) {
        return {
          isError: true,
          content: [{ type: "text", text: `No document ${id}. Call kb_list_documents for valid ids.` }],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
    },
  );

  server.registerTool(
    "baseline_model",
    {
      title: "Current production baseline",
      description:
        "Describe the currently deployed model: name, benchmark suite, promotion metric, and the score every candidate must beat.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify({ baseline: BASELINE_MODEL }, null, 2) }],
    }),
  );

  server.registerTool(
    "experiment_register",
    {
      title: "Register an experiment result",
      description:
        "Record one experiment run in the shared registry. Register every run including failures — negative results steer the next round. Report the metric from the trusted harness only.",
      inputSchema: {
        run_name: z.string().describe("Unique run name, e.g. 'lora-r16-lr2e4-round2'"),
        provider: z.string().describe("Where it ran: 'aws', 'gcp', 'local', ..."),
        metric_name: z.string().describe("Metric name, e.g. 'macro_f1'"),
        metric_value: z.number().describe("Metric value from the trusted benchmark harness"),
        config_summary: z.string().describe("One-line config: method, key hyperparameters, data snapshot"),
        artifact_uri: z.string().optional().describe("Model artifact location (s3:// or gs:// URI)"),
        notes: z.string().optional().describe("Observations: what worked, what failed, follow-ups"),
      },
    },
    async (input) => {
      const entry = registerExperiment(input);
      const board = leaderboard(entry.metric_name);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                registered: entry,
                rank: board.entries.findIndex((row) => row.run_name === entry.run_name) + 1,
                beats_baseline: entry.metric_value > BASELINE_MODEL.score,
                baseline: board.baseline,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "experiment_leaderboard",
    {
      title: "Experiment leaderboard",
      description:
        "Show all registered experiment runs for a metric, ranked, alongside the production baseline score.",
      inputSchema: {
        metric: z.string().optional().describe("Metric name (default 'macro_f1')"),
      },
    },
    async ({ metric }) => ({
      content: [{ type: "text", text: JSON.stringify(leaderboard(metric), null, 2) }],
    }),
  );

  return server;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const http = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, server: "research-kb-mcp" }));
    return;
  }

  if (request.method === "POST" && (url.pathname === "/mcp" || url.pathname === "/")) {
    // Stateless Streamable HTTP: a fresh server+transport per request so no
    // session state is required (see the MCP spec's stateless pattern).
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, await readBody(request));
    } catch (error) {
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: error instanceof Error ? error.message : "Internal error" },
            id: null,
          }),
        );
      }
    }
    return;
  }

  // No SSE streams or session DELETEs in stateless mode.
  response.writeHead(405, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Method not allowed; POST JSON-RPC to /mcp" }));
});

http.listen(PORT, () => {
  console.log(`research-kb-mcp listening on :${PORT} (POST /mcp, GET /healthz)`);
});
