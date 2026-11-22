#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BridgeHub } from './bridge-hub.js';
import { createBridgeMcpServer } from './server.js';

async function main(): Promise<void> {
  const hub = new BridgeHub();
  await hub.start();

  const server = createBridgeMcpServer(hub);
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.error(`[figma-bridge] Received ${signal}, shutting down...`);
    try {
      await server.close();
      await hub.close();
    } catch (err) {
      console.error('[figma-bridge] Error during shutdown:', err);
    }
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await server.connect(transport);
  console.error('[figma-bridge] MCP stdio server ready.');
}

main().catch((err) => {
  console.error('[figma-bridge] Fatal startup error:', err);
  process.exit(1);
});
