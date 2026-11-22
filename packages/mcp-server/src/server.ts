import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type {
  BridgeStatus,
  ExportedImage,
  NodeResult,
  SelectionResult,
  SerializedTokens,
} from '@figma-bridge/shared';
import { BridgeError, type BridgeHub } from './bridge-hub.js';

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function jsonTextResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function formatToolError(err: unknown): CallToolResult {
  if (err instanceof BridgeError) {
    return {
      isError: true,
      content: [{ type: 'text', text: `[${err.code}] ${err.message}` }],
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: 'text', text: `[INTERNAL_ERROR] ${message}` }],
  };
}

export function createBridgeMcpServer(hub: BridgeHub): McpServer {
  const server = new McpServer({
    name: 'figma-bridge',
    version: '0.1.0',
  });

  server.registerTool(
    'get_bridge_status',
    {
      title: 'Get Figma Bridge Status',
      description:
        'Check whether the Figma Desktop plugin is connected and inspect the active file name, page name, and selection summary.',
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      if (!hub.isConnected()) {
        const disconnected: BridgeStatus = {
          connected: false,
          port: hub.port,
          fileName: null,
          pageName: null,
          selectionCount: 0,
        };
        return jsonTextResult(disconnected);
      }

      try {
        const status = await hub.request<BridgeStatus>('get_status');
        return jsonTextResult({
          ...status,
          connected: true,
          port: hub.port,
        });
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  server.registerTool(
    'get_selection',
    {
      title: 'Get Current Figma Selection',
      description:
        'Return compact serialized layer trees (layout, bounds, styles, fills, strokes, effects, text) for the currently selected layers in Figma Desktop.',
      inputSchema: {
        depth: z
          .number()
          .int()
          .min(0)
          .max(20)
          .default(4)
          .describe('Maximum child tree depth to serialize (default: 4)'),
        includeHidden: z
          .boolean()
          .default(false)
          .describe('Whether to include hidden layers (visible === false)'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ depth, includeHidden }) => {
      try {
        const result = await hub.request<SelectionResult>('get_selection', {
          depth,
          includeHidden,
        });
        return jsonTextResult(result);
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  server.registerTool(
    'get_node',
    {
      title: 'Get Figma Node by ID',
      description:
        'Read a specific Figma node subtree by its nodeId (for example "12:34").',
      inputSchema: {
        nodeId: z.string().min(1).describe('Figma node ID (e.g. "12:34")'),
        depth: z
          .number()
          .int()
          .min(0)
          .max(20)
          .default(4)
          .describe('Maximum child tree depth to serialize (default: 4)'),
        includeHidden: z
          .boolean()
          .default(false)
          .describe('Whether to include hidden layers (visible === false)'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ nodeId, depth, includeHidden }) => {
      try {
        const result = await hub.request<NodeResult>('get_node', {
          nodeId,
          depth,
          includeHidden,
        });
        return jsonTextResult(result);
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  server.registerTool(
    'export_node_image',
    {
      title: 'Export Figma Node Image',
      description:
        'Export a Figma node (or the first currently selected node if nodeId is omitted) as a PNG image for visual inspection or as raw SVG markup.',
      inputSchema: {
        nodeId: z
          .string()
          .min(1)
          .optional()
          .describe('Target Figma node ID. Defaults to the first currently selected node.'),
        format: z
          .enum(['PNG', 'SVG'])
          .default('PNG')
          .describe('Output format: PNG (image content block) or SVG (SVG markup text)'),
        scale: z
          .number()
          .min(0.25)
          .max(4)
          .default(2)
          .describe('Export scale factor for PNG (default: 2)'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ nodeId, format, scale }) => {
      try {
        const exported = await hub.request<ExportedImage>('export_node_image', {
          nodeId,
          format,
          scale,
        });

        const metadata = {
          nodeId: exported.nodeId,
          nodeName: exported.nodeName,
          format: exported.format,
          scale: exported.scale,
          width: exported.width,
          height: exported.height,
        };

        if (exported.format === 'PNG') {
          return {
            content: [
              {
                type: 'image',
                data: exported.data,
                mimeType: 'image/png',
              },
              {
                type: 'text',
                text: JSON.stringify(metadata, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: exported.data,
            },
            {
              type: 'text',
              text: JSON.stringify(metadata, null, 2),
            },
          ],
        };
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  server.registerTool(
    'get_local_tokens',
    {
      title: 'Get Local Design Tokens',
      description:
        'Extract local paint styles, text styles, effect styles, and local Figma variables/collections from the active file.',
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      try {
        const tokens = await hub.request<SerializedTokens>('get_local_tokens');
        return jsonTextResult(tokens);
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  return server;
}
