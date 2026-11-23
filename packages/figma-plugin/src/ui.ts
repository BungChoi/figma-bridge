import { DEFAULT_BRIDGE_PORT } from '@figma-bridge/shared';

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface UiToPluginMessage {
  type: 'bridge-request';
  payload: unknown;
}

interface PluginToUiMessage {
  type: 'bridge-response';
  payload: unknown;
}

const STORAGE_KEY = 'figma-bridge-port';
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 10000;

const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const portInput = document.getElementById('port-input') as HTMLInputElement;
const reconnectBtn = document.getElementById('reconnect-btn') as HTMLButtonElement;
const detailText = document.getElementById('detail-text') as HTMLDivElement;

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempts = 0;
let manualClose = false;

function readSavedPort(): number {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = Number.parseInt(saved, 10);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
        return parsed;
      }
    }
  } catch {
    // localStorage may be disabled in sandboxed iframe contexts
  }
  return DEFAULT_BRIDGE_PORT;
}

function savePort(port: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(port));
  } catch {
    // Ignore storage failures
  }
}

function getTargetPort(): number {
  const parsed = Number.parseInt(portInput.value, 10);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
    return parsed;
  }
  portInput.value = String(DEFAULT_BRIDGE_PORT);
  return DEFAULT_BRIDGE_PORT;
}

function setStatus(state: ConnectionState, detail: string): void {
  statusDot.dataset.state = state;
  const labels: Record<ConnectionState, string> = {
    connecting: 'Connecting...',
    connected: 'Connected',
    disconnected: 'Disconnected',
    reconnecting: 'Reconnecting...',
  };
  statusText.textContent = labels[state];
  detailText.textContent = detail;
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  clearReconnectTimer();
  const delay = Math.min(
    BASE_RECONNECT_DELAY_MS * Math.pow(1.5, reconnectAttempts),
    MAX_RECONNECT_DELAY_MS,
  );
  reconnectAttempts += 1;
  setStatus('reconnecting', `Retrying in ${Math.round(delay / 1000)}s...`);
  reconnectTimer = window.setTimeout(() => {
    connect();
  }, delay);
}

function connect(): void {
  clearReconnectTimer();

  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    manualClose = true;
    socket.close();
  }

  const port = getTargetPort();
  savePort(port);
  const url = `ws://localhost:${port}`;
  manualClose = false;
  setStatus('connecting', url);

  const ws = new WebSocket(url);
  socket = ws;

  ws.addEventListener('open', () => {
    if (socket !== ws) {
      return;
    }
    reconnectAttempts = 0;
    setStatus('connected', url);
  });

  ws.addEventListener('message', (event) => {
    if (socket !== ws) {
      return;
    }
    try {
      const payload = JSON.parse(String(event.data));
      const msg: UiToPluginMessage = {
        type: 'bridge-request',
        payload,
      };
      parent.postMessage({ pluginMessage: msg }, '*');
    } catch {
      setStatus('connected', 'Ignored invalid JSON frame');
    }
  });

  ws.addEventListener('close', () => {
    if (socket !== ws) {
      return;
    }
    socket = null;
    if (!manualClose) {
      scheduleReconnect();
    } else {
      setStatus('disconnected', 'Stopped');
    }
  });

  ws.addEventListener('error', () => {
    // WebSocket error is always followed by close; detail updated on close
  });
}

window.addEventListener('message', (event: MessageEvent<{ pluginMessage?: PluginToUiMessage }>) => {
  const pluginMessage = event.data?.pluginMessage;
  if (!pluginMessage || pluginMessage.type !== 'bridge-response') {
    return;
  }
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(pluginMessage.payload));
  }
});

reconnectBtn.addEventListener('click', () => {
  reconnectAttempts = 0;
  connect();
});

portInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    reconnectAttempts = 0;
    connect();
  }
});

portInput.value = String(readSavedPort());
connect();
