// Conexão com o servidor MCP por Streamable HTTP, com o token compartilhado.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export async function connectMcp(url: string, authToken: string): Promise<Client> {
  const client = new Client({ name: 'booking-agent', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${authToken}` } },
  });
  await client.connect(transport);
  return client;
}
