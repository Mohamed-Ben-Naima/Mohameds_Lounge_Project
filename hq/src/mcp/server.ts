// stdio MCP server launched by each agent's claude process. A thin proxy: it holds the run
// token and forwards every list/call to HQ, which enforces the rules.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const HQ_URL = process.env.HQ_URL;
const TOKEN = process.env.HQ_RUN_TOKEN;
if (!HQ_URL || !TOKEN) {
  process.stderr.write('hq mcp: HQ_URL and HQ_RUN_TOKEN are required\n');
  process.exit(1);
}

const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

const server = new Server({ name: 'hq', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const res = await fetch(`${HQ_URL}/internal/tools`, { headers });
  if (!res.ok) throw new Error(`HQ refused to list tools (${res.status})`);
  return { tools: await res.json() };
});

server.setRequestHandler(CallToolRequestSchema, async req => {
  const res = await fetch(`${HQ_URL}/internal/tool/${encodeURIComponent(req.params.name)}`, {
    method: 'POST', headers, body: JSON.stringify({ args: req.params.arguments ?? {} }),
  });
  const body = await res.text();
  return { content: [{ type: 'text', text: body }], isError: res.status !== 200 };
});

await server.connect(new StdioServerTransport());
