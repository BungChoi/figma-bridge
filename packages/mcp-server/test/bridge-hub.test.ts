import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { BridgeRequest, BridgeResponse } from '@figma-bridge/shared';
import { BridgeError, BridgeHub } from '../src/bridge-hub.js';
import { createBridgeMcpServer } from '../src/server.js';

async function connectMockPlugin(
  port: number,
  onRequest: (req: BridgeRequest, ws: WebSocket) => void | Promise<void>,
): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  ws.on('message', (data) => {
    const req = JSON.parse(data.toString()) as BridgeRequest;
    void onRequest(req, ws);
  });

  return ws;
}

describe('BridgeHub & MCP Server', () => {
  const hubs: BridgeHub[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
    for (const hub of hubs.splice(0)) {
      await hub.close();
    }
  });

  it('completes request/response round-trip with a connected mock plugin', async () => {
    const hub = new BridgeHub({ port: 0, logger: () => {} });
    hubs.push(hub);
    const port = await hub.start();

    const plugin = await connectMockPlugin(port, (req, ws) => {
      const response: BridgeResponse = {
        id: req.id,
        ok: true,
        result: {
          connected: true,
          fileName: 'Design System.fig',
          pageName: 'Components',
          selectionCount: 1,
        },
      };
      ws.send(JSON.stringify(response));
    });
    sockets.push(plugin);

    const status = await hub.request<{ fileName: string; selectionCount: number }>('get_status');
    assert.equal(status.fileName, 'Design System.fig');
    assert.equal(status.selectionCount, 1);
  });

  it('throws PLUGIN_NOT_CONNECTED when no plugin is attached', async () => {
    const hub = new BridgeHub({ port: 0, logger: () => {} });
    hubs.push(hub);
    await hub.start();

    await assert.rejects(
      () => hub.request('get_selection'),
      (err: unknown) => err instanceof BridgeError && err.code === 'PLUGIN_NOT_CONNECTED',
    );
  });

  it('rejects with REQUEST_TIMEOUT when the plugin does not reply in time', async () => {
    const hub = new BridgeHub({ port: 0, requestTimeoutMs: 60, logger: () => {} });
    hubs.push(hub);
    const port = await hub.start();

    const plugin = await connectMockPlugin(port, () => {
      // Intentionally ignore request to trigger timeout
    });
    sockets.push(plugin);

    await assert.rejects(
      () => hub.request('get_node', { nodeId: '1:2' }),
      (err: unknown) => err instanceof BridgeError && err.code === 'REQUEST_TIMEOUT',
    );
  });

  it('rejects pending requests with PLUGIN_DISCONNECTED if the plugin closes mid-flight', async () => {
    const hub = new BridgeHub({ port: 0, requestTimeoutMs: 5000, logger: () => {} });
    hubs.push(hub);
    const port = await hub.start();

    const plugin = await connectMockPlugin(port, (_req, ws) => {
      ws.close();
    });
    sockets.push(plugin);

    await assert.rejects(
      () => hub.request('get_local_tokens'),
      (err: unknown) => err instanceof BridgeError && err.code === 'PLUGIN_DISCONNECTED',
    );
  });

  it('handles all 5 MCP tools through InMemoryTransport', async () => {
    const hub = new BridgeHub({ port: 0, logger: () => {} });
    hubs.push(hub);
    const port = await hub.start();

    const server = createBridgeMcpServer(hub);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.1.0' });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      // 1. Disconnected status should succeed cleanly without throwing
      const disconnectedRes = await client.callTool({ name: 'get_bridge_status', arguments: {} });
      assert.equal(disconnectedRes.isError, undefined);
      const disconnectedText = (disconnectedRes.content[0] as { type: 'text'; text: string }).text;
      assert.equal(JSON.parse(disconnectedText).connected, false);

      // Connect mock plugin handling all 5 bridge methods
      const plugin = await connectMockPlugin(port, (req, ws) => {
        const respond = (result: unknown) => {
          const payload: BridgeResponse = { id: req.id, ok: true, result };
          ws.send(JSON.stringify(payload));
        };

        switch (req.method) {
          case 'get_status':
            respond({
              connected: true,
              fileName: 'App UI.fig',
              pageName: 'Home',
              selectionCount: 1,
            });
            break;
          case 'get_selection':
            respond({
              pageName: 'Home',
              selectionCount: 1,
              nodes: [
                {
                  id: '10:20',
                  name: 'HeroCard',
                  type: 'FRAME',
                  visible: true,
                },
              ],
            });
            break;
          case 'get_node':
            respond({
              node: {
                id: String(req.params?.nodeId),
                name: 'Button',
                type: 'COMPONENT',
                visible: true,
              },
            });
            break;
          case 'export_node_image': {
            const format = req.params?.format === 'SVG' ? 'SVG' : 'PNG';
            respond({
              nodeId: '10:20',
              nodeName: 'HeroCard',
              format,
              mimeType: format === 'PNG' ? 'image/png' : 'image/svg+xml',
              scale: Number(req.params?.scale ?? 2),
              width: 320,
              height: 180,
              data: format === 'PNG' ? 'AQID' : '<svg width="320" height="180"></svg>',
            });
            break;
          }
          case 'get_local_tokens':
            respond({
              paintStyles: [{ id: 'S:1', name: 'Brand/Primary', paints: [{ type: 'SOLID', color: '#2563EB' }] }],
              textStyles: [],
              effectStyles: [],
              variableCollections: [],
              variables: [],
            });
            break;
        }
      });
      sockets.push(plugin);

      const toolsList = await client.listTools();
      assert.deepEqual(
        toolsList.tools.map((t) => t.name).sort(),
        ['export_node_image', 'get_bridge_status', 'get_local_tokens', 'get_node', 'get_selection'],
      );

      const statusRes = await client.callTool({ name: 'get_bridge_status', arguments: {} });
      assert.equal(JSON.parse((statusRes.content[0] as { text: string }).text).fileName, 'App UI.fig');

      const selRes = await client.callTool({
        name: 'get_selection',
        arguments: { depth: 2, includeHidden: false },
      });
      assert.equal(JSON.parse((selRes.content[0] as { text: string }).text).nodes[0].id, '10:20');

      const nodeRes = await client.callTool({
        name: 'get_node',
        arguments: { nodeId: '99:1' },
      });
      assert.equal(JSON.parse((nodeRes.content[0] as { text: string }).text).node.id, '99:1');

      const pngRes = await client.callTool({
        name: 'export_node_image',
        arguments: { format: 'PNG', scale: 2 },
      });
      assert.deepEqual(pngRes.content[0], {
        type: 'image',
        data: 'AQID',
        mimeType: 'image/png',
      });

      const svgRes = await client.callTool({
        name: 'export_node_image',
        arguments: { format: 'SVG' },
      });
      assert.equal((svgRes.content[0] as { text: string }).text, '<svg width="320" height="180"></svg>');

      const tokensRes = await client.callTool({ name: 'get_local_tokens', arguments: {} });
      assert.equal(
        JSON.parse((tokensRes.content[0] as { text: string }).text).paintStyles[0].name,
        'Brand/Primary',
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});
