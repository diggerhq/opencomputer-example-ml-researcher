import { defineMcpServer } from "@opencomputer/agent";

/**
 * The in-house research knowledge base, attached as a managed MCP server.
 *
 * Deploy the bundled dummy server in `mcp-server/` (or your real in-house
 * MCP) to any HTTPS endpoint, then replace this URL. Managed MCP URLs must be
 * HTTPS literals in source — OpenComputer collects them at build time, so the
 * URL cannot come from an environment variable.
 *
 * Quick local testing: `cd mcp-server && npm start`, then
 * `cloudflared tunnel --url http://localhost:8787` and use the printed
 * https://*.trycloudflare.com URL with the /mcp path.
 */
export const knowledgeBase = defineMcpServer({
  id: "research-kb",
  url: "https://research-kb-mcp.example.com/mcp",
});
