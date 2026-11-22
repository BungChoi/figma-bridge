import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import {
  DEFAULT_BRIDGE_PORT,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type BridgeMethod,
  type BridgeRequest,
  type BridgeResponse,
} from '@figma-bridge/shared';

export class BridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}

export interface BridgeHubOptions {
  host?: string;
  port?: number;
  requestTimeoutMs?: number;
  logger?: (message: string) => void;
}

interface PendingRequest {
  socket: WebSocket;
  timer: NodeJS.Timeout;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export function resolveBridgePort(envValue = process.env.FIGMA_BRIDGE_PORT): number {
  if (!envValue) {
    return DEFAULT_BRIDGE_PORT;
  }
  const parsed = Number.parseInt(envValue, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new BridgeError(
      'INVALID_PORT',
      `Invalid FIGMA_BRIDGE_PORT "${envValue}". Expected an integer between 1 and 65535.`,
    );
  }
  return parsed;
}

export class BridgeHub {
  private readonly host: string;
  private configuredPort: number;
  private readonly requestTimeoutMs: number;
  private readonly log: (message: string) => void;

  private wss: WebSocketServer | null = null;
  private activeSocket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(options: BridgeHubOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.configuredPort = options.port ?? resolveBridgePort();
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.log = options.logger ?? ((msg) => console.error(`[figma-bridge] ${msg}`));
  }

  get port(): number {
    return this.configuredPort;
  }

  isConnected(): boolean {
    return this.activeSocket !== null && this.activeSocket.readyState === WebSocket.OPEN;
  }

  async start(): Promise<number> {
    if (this.wss) {
      return this.configuredPort;
    }

    const wss = new WebSocketServer({
      host: this.host,
      port: this.configuredPort,
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        wss.off('listening', onListening);
        if (err.code === 'EADDRINUSE') {
          const message =
            `Port ${this.configuredPort} on ${this.host} is already in use. ` +
            'Stop the existing figma-bridge process or set FIGMA_BRIDGE_PORT to a free port.';
          this.log(message);
          reject(new BridgeError('PORT_IN_USE', message));
          return;
        }
        this.log(`WebSocket server failed to start: ${err.message}`);
        reject(err);
      };

      const onListening = () => {
        wss.off('error', onError);
        const address = wss.address();
        if (address && typeof address === 'object') {
          this.configuredPort = address.port;
        }
        this.log(`WebSocket bridge listening on ws://${this.host}:${this.configuredPort}`);
        resolve();
      };

      wss.once('error', onError);
      wss.once('listening', onListening);
    });

    this.wss = wss;

    wss.on('connection', (ws) => {
      this.attachSocket(ws);
    });

    wss.on('error', (err) => {
      this.log(`WebSocket server error: ${err.message}`);
    });

    return this.configuredPort;
  }

  async close(): Promise<void> {
    this.rejectPendingForReason(
      new BridgeError('BRIDGE_CLOSED', 'Figma bridge server is shutting down.'),
    );

    if (this.activeSocket) {
      const socket = this.activeSocket;
      this.activeSocket = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, 'Bridge server shutting down');
      }
    }

    if (this.wss) {
      const server = this.wss;
      this.wss = null;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  }

  async request<T = unknown>(
    method: BridgeMethod,
    params?: Record<string, unknown>,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    const socket = this.activeSocket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new BridgeError(
        'PLUGIN_NOT_CONNECTED',
        `Figma Desktop plugin is not connected on ws://${this.host}:${this.configuredPort}. ` +
          'Open Figma Desktop and run Plugins -> Development -> Figma Local Bridge.',
      );
    }

    const id = randomUUID();
    const payload: BridgeRequest = params === undefined ? { id, method } : { id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BridgeError(
            'REQUEST_TIMEOUT',
            `Figma plugin did not respond to "${method}" within ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);

      this.pending.set(id, {
        socket,
        timer,
        resolve: (value) => resolve(value as T),
        reject,
      });

      socket.send(JSON.stringify(payload), (err) => {
        if (err) {
          const entry = this.pending.get(id);
          if (entry) {
            clearTimeout(entry.timer);
            this.pending.delete(id);
            entry.reject(
              new BridgeError('SEND_FAILED', `Failed to send "${method}" to plugin: ${err.message}`),
            );
          }
        }
      });
    });
  }

  private attachSocket(ws: WebSocket): void {
    const previous = this.activeSocket;
    if (previous && previous !== ws) {
      this.log('Replacing existing Figma plugin connection with new client.');
      this.rejectPendingForSocket(
        previous,
        new BridgeError('PLUGIN_REPLACED', 'Figma plugin connection was replaced by a newer session.'),
      );
      if (previous.readyState === WebSocket.OPEN || previous.readyState === WebSocket.CONNECTING) {
        previous.close(1000, 'Replaced by new plugin connection');
      }
    }

    this.activeSocket = ws;
    this.log('Figma Desktop plugin connected.');

    ws.on('message', (data) => {
      this.handleMessage(data.toString());
    });

    ws.on('close', () => {
      if (this.activeSocket === ws) {
        this.activeSocket = null;
        this.log('Figma Desktop plugin disconnected.');
      }
      this.rejectPendingForSocket(
        ws,
        new BridgeError(
          'PLUGIN_DISCONNECTED',
          'Figma Desktop plugin disconnected before completing the request.',
        ),
      );
    });

    ws.on('error', (err) => {
      this.log(`Figma plugin socket error: ${err.message}`);
    });
  }

  private handleMessage(raw: string): void {
    let parsed: BridgeResponse;
    try {
      parsed = JSON.parse(raw) as BridgeResponse;
    } catch {
      this.log('Received invalid JSON frame from Figma plugin.');
      return;
    }

    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.ok !== 'boolean') {
      return;
    }

    const entry = this.pending.get(parsed.id);
    if (!entry) {
      return;
    }

    clearTimeout(entry.timer);
    this.pending.delete(parsed.id);

    if (parsed.ok) {
      entry.resolve(parsed.result);
    } else {
      const code = parsed.error?.code ?? 'PLUGIN_ERROR';
      const message = parsed.error?.message ?? 'Unknown error from Figma plugin.';
      entry.reject(new BridgeError(code, message));
    }
  }

  private rejectPendingForSocket(socket: WebSocket, error: BridgeError): void {
    for (const [id, entry] of this.pending.entries()) {
      if (entry.socket === socket) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.reject(error);
      }
    }
  }

  private rejectPendingForReason(error: BridgeError): void {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(error);
    }
  }
}
