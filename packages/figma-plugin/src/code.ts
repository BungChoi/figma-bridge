import {
  DEFAULT_BRIDGE_PORT,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeStatus,
  type ExportedImage,
  type NodeResult,
  type SelectionResult,
} from '@figma-bridge/shared';
import { serializeLocalTokens, serializeNode } from './serializer.js';

const STORAGE_KEY_PORT = 'figma-bridge:port';
const STORAGE_KEY_MINIMIZED = 'figma-bridge:minimized';

const EXPANDED_SIZE = { width: 280, height: 156 } as const;
const MINIMIZED_SIZE = { width: 192, height: 40 } as const;

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

type UiToPluginMessage =
  | { type: 'bridge-request'; payload: BridgeRequest }
  | { type: 'ui-ready' }
  | { type: 'ui-toggle-minimize'; minimized: boolean }
  | { type: 'ui-hide-to-background' }
  | { type: 'ui-save-port'; port: number }
  | { type: 'ui-connection-status'; state: ConnectionState; port: number };

class PluginRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PluginRequestError';
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

function isValidPort(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 65535;
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
      const requestedId =
        typeof params.nodeId === 'string' && params.nodeId.trim().length > 0
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
      const width =
        'width' in targetNode && typeof targetNode.width === 'number'
          ? Math.round(targetNode.width)
          : undefined;
      const height =
        'height' in targetNode && typeof targetNode.height === 'number'
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
      throw new PluginRequestError(
        'UNKNOWN_METHOD',
        `Unsupported bridge method "${String(req.method)}".`,
      );
    }
  }
}

let isUiHidden = figma.command === 'run-background';
let lastNotifiedConnection: 'connected' | 'disconnected' | null = null;

figma.showUI(__html__, {
  width: EXPANDED_SIZE.width,
  height: EXPANDED_SIZE.height,
  visible: !isUiHidden,
  themeColors: true,
});

if (isUiHidden) {
  figma.notify('Figma Local Bridge connecting in background...', { timeout: 2500 });
}

async function sendInitialState(): Promise<void> {
  let savedPort = DEFAULT_BRIDGE_PORT;
  let savedMinimized = false;

  try {
    const [storedPort, storedMinimized] = await Promise.all([
      figma.clientStorage.getAsync(STORAGE_KEY_PORT),
      figma.clientStorage.getAsync(STORAGE_KEY_MINIMIZED),
    ]);
    if (isValidPort(storedPort)) {
      savedPort = storedPort;
    }
    if (typeof storedMinimized === 'boolean') {
      savedMinimized = storedMinimized;
    }
  } catch {
    // Fall back to defaults if clientStorage is unavailable
  }

  if (!isUiHidden && savedMinimized) {
    figma.ui.resize(MINIMIZED_SIZE.width, MINIMIZED_SIZE.height);
  }

  figma.ui.postMessage({
    type: 'ui-init',
    payload: {
      port: savedPort,
      minimized: savedMinimized,
    },
  });
}

figma.on('run', ({ command }) => {
  if (command === 'open-ui' && isUiHidden) {
    isUiHidden = false;
    figma.ui.show();
  }
});

function handleConnectionStatusNotification(state: ConnectionState, port: number): void {
  if (state === 'connected') {
    const changed = lastNotifiedConnection !== 'connected';
    lastNotifiedConnection = 'connected';
    if (isUiHidden && changed) {
      figma.notify(`Figma Local Bridge connected (ws://localhost:${port})`, { timeout: 3000 });
    }
    return;
  }

  if (state === 'reconnecting' || state === 'disconnected') {
    const wasConnected = lastNotifiedConnection === 'connected';
    lastNotifiedConnection = 'disconnected';
    if (isUiHidden && wasConnected) {
      figma.notify(`Figma Local Bridge disconnected from localhost:${port} — retrying...`, {
        error: true,
        timeout: 3500,
      });
    }
  }
}

figma.ui.onmessage = async (msg: unknown) => {
  if (!msg || typeof msg !== 'object' || !('type' in msg)) {
    return;
  }

  const typedMsg = msg as Partial<UiToPluginMessage>;

  switch (typedMsg.type) {
    case 'ui-ready': {
      await sendInitialState();
      return;
    }

    case 'ui-toggle-minimize': {
      const minimized = typedMsg.minimized === true;
      isUiHidden = false;
      figma.ui.resize(
        minimized ? MINIMIZED_SIZE.width : EXPANDED_SIZE.width,
        minimized ? MINIMIZED_SIZE.height : EXPANDED_SIZE.height,
      );
      try {
        await figma.clientStorage.setAsync(STORAGE_KEY_MINIMIZED, minimized);
      } catch {
        // Ignore storage errors
      }
      return;
    }

    case 'ui-hide-to-background': {
      isUiHidden = true;
      figma.ui.hide();
      figma.notify(
        'Figma Local Bridge running in background. Reopen via Plugins -> Development -> Figma Local Bridge -> Open Bridge UI.',
        { timeout: 4000 },
      );
      return;
    }

    case 'ui-save-port': {
      if (isValidPort(typedMsg.port)) {
        try {
          await figma.clientStorage.setAsync(STORAGE_KEY_PORT, typedMsg.port);
        } catch {
          // Ignore storage errors
        }
      }
      return;
    }

    case 'ui-connection-status': {
      if (typeof typedMsg.state === 'string' && isValidPort(typedMsg.port)) {
        handleConnectionStatusNotification(typedMsg.state, typedMsg.port);
      }
      return;
    }

    case 'bridge-request': {
      const req = typedMsg.payload;
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
      return;
    }
  }
};
