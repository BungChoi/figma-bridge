import type {
  BridgeRequest,
  BridgeResponse,
  BridgeStatus,
  ExportedImage,
  NodeResult,
  SelectionResult,
} from '@figma-bridge/shared';
import { serializeLocalTokens, serializeNode } from './serializer.js';

interface UiBridgeMessage {
  type: 'bridge-request';
  payload: BridgeRequest;
}

class PluginRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function clampDepth(raw: unknown, fallback = 4): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(0, Math.min(20, Math.floor(raw)));
}

function clampScale(raw: unknown, fallback = 2): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(0.25, Math.min(4, raw));
}

async function handleRequest(req: BridgeRequest): Promise<unknown> {
  const params = req.params ?? {};

  switch (req.method) {
    case 'get_status': {
      const selection = figma.currentPage.selection;
      const status: BridgeStatus = {
        connected: true,
        fileName: figma.root.name,
        pageName: figma.currentPage.name,
        selectionCount: selection.length,
        selection: selection.map((node) => ({
          id: node.id,
          name: node.name,
          type: node.type,
        })),
      };
      return status;
    }

    case 'get_selection': {
      const depth = clampDepth(params.depth, 4);
      const includeHidden = params.includeHidden === true;
      const selection = figma.currentPage.selection;

      const nodes = await Promise.all(
        selection.map((node) => serializeNode(node, depth, includeHidden)),
      );

      const result: SelectionResult = {
        pageName: figma.currentPage.name,
        selectionCount: selection.length,
        nodes,
      };
      return result;
    }

    case 'get_node': {
      const nodeId = params.nodeId;
      if (typeof nodeId !== 'string' || nodeId.trim().length === 0) {
        throw new PluginRequestError('INVALID_PARAMS', 'nodeId must be a non-empty string.');
      }

      const depth = clampDepth(params.depth, 4);
      const includeHidden = params.includeHidden === true;
      const node = await figma.getNodeByIdAsync(nodeId);
      if (!node) {
        throw new PluginRequestError('NODE_NOT_FOUND', `Node "${nodeId}" was not found.`);
      }

      const result: NodeResult = {
        node: await serializeNode(node, depth, includeHidden),
      };
      return result;
    }

    case 'export_node_image': {
      const requestedId = typeof params.nodeId === 'string' && params.nodeId.trim().length > 0
        ? params.nodeId.trim()
        : undefined;

      const targetNode: BaseNode | null = requestedId
        ? await figma.getNodeByIdAsync(requestedId)
        : (figma.currentPage.selection[0] ?? null);

      if (!targetNode) {
        throw new PluginRequestError(
          requestedId ? 'NODE_NOT_FOUND' : 'NO_SELECTION',
          requestedId
            ? `Node "${requestedId}" was not found.`
            : 'No nodeId was provided and nothing is currently selected in Figma.',
        );
      }

      if (!('exportAsync' in targetNode)) {
        throw new PluginRequestError(
          'NOT_EXPORTABLE',
          `Node "${targetNode.id}" (${targetNode.type}) does not support exportAsync.`,
        );
      }

      const format = params.format === 'SVG' ? 'SVG' : 'PNG';
      const scale = clampScale(params.scale, 2);
      const width = 'width' in targetNode && typeof targetNode.width === 'number'
        ? Math.round(targetNode.width)
        : undefined;
      const height = 'height' in targetNode && typeof targetNode.height === 'number'
        ? Math.round(targetNode.height)
        : undefined;

      if (format === 'SVG') {
        const svg = await targetNode.exportAsync({ format: 'SVG_STRING' });
        const exported: ExportedImage = {
          nodeId: targetNode.id,
          nodeName: targetNode.name,
          format: 'SVG',
          mimeType: 'image/svg+xml',
          scale: 1,
          width,
          height,
          data: svg,
        };
        return exported;
      }

      const bytes = await targetNode.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: scale },
      });
      const exported: ExportedImage = {
        nodeId: targetNode.id,
        nodeName: targetNode.name,
        format: 'PNG',
        mimeType: 'image/png',
        scale,
        width,
        height,
        data: figma.base64Encode(bytes),
      };
      return exported;
    }

    case 'get_local_tokens': {
      return await serializeLocalTokens();
    }

    default: {
      throw new PluginRequestError('UNKNOWN_METHOD', `Unsupported bridge method "${String(req.method)}".`);
    }
  }
}

figma.showUI(__html__, { width: 280, height: 150, themeColors: true });

figma.ui.onmessage = async (msg: unknown) => {
  if (
    !msg ||
    typeof msg !== 'object' ||
    (msg as Partial<UiBridgeMessage>).type !== 'bridge-request'
  ) {
    return;
  }

  const req = (msg as UiBridgeMessage).payload;
  if (!req || typeof req.id !== 'string' || typeof req.method !== 'string') {
    return;
  }

  let response: BridgeResponse;
  try {
    const result = await handleRequest(req);
    response = { id: req.id, ok: true, result };
  } catch (err) {
    if (err instanceof PluginRequestError) {
      response = {
        id: req.id,
        ok: false,
        error: { code: err.code, message: err.message },
      };
    } else {
      response = {
        id: req.id,
        ok: false,
        error: {
          code: 'PLUGIN_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  figma.ui.postMessage({
    type: 'bridge-response',
    payload: response,
  });
};
