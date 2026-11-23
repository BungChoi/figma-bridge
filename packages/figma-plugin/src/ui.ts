import { DEFAULT_BRIDGE_PORT } from '@figma-bridge/shared';

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface UiInitPayload {
  port: number;
  minimized: boolean;
}

type PluginToUiMessage =
  | { type: 'bridge-response'; payload: unknown }
  | { type: 'ui-init'; payload: UiInitPayload };

const STORAGE_KEY_PORT = 'figma-bridge-port';
const STORAGE_KEY_MINIMIZED = 'figma-bridge-minimized';
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 10000;

const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const portBadge = document.getElementById('port-badge') as HTMLSpanElement;
const portInput = document.getElementById('port-input') as HTMLInputElement;
const reconnectBtn = document.getElementById('reconnect-btn') as HTMLButtonElement;
const minimizeBtn = document.getElementById('minimize-btn') as HTMLButtonElement;
const hideBtn = document.getElementById('hide-btn') as HTMLButtonElement;
const detailText = document.getElementById('detail-text') as HTMLDivElement;

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempts = 0;
let manualClose = false;
let isMinimized = false;
let initialized = false;

function readSavedPort(): number {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY_PORT);
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

function readSavedMinimized(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY_MINIMIZED) === 'true';
  } catch {
    return false;
  }
}

function savePort(port: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY_PORT, String(port));
  } catch {
    // Ignore storage failures
  }
  parent.postMessage({ pluginMessage: { type: 'ui-save-port', port } }, '*');
}

function applyMinimizedState(minimized: boolean, notifyPlugin: boolean): void {
  isMinimized = minimized;
  document.body.dataset.minimized = minimized ? 'true' : 'false';
  minimizeBtn.textContent = minimized ? '+' : '–';
  minimizeBtn.title = minimized ? 'Expand popup' : 'Minimize to compact bar';
  minimizeBtn.setAttribute('aria-label', minimizeBtn.title);

  try {
    window.localStorage.setItem(STORAGE_KEY_MINIMIZED, String(minimized));
  } catch {
    // Ignore storage failures
  }

  if (notifyPlugin) {
    parent.postMessage(
      { pluginMessage: { type: 'ui-toggle-minimize', minimized } },
      '*',
    );
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

function setStatus(state: ConnectionState, detail: string, port: number): void {
  statusDot.dataset.state = state;
  const labels: Record<ConnectionState, string> = {
    connecting: 'Connecting...',
    connected: 'Connected',
    disconnected: 'Disconnected',
    reconnecting: 'Reconnecting...',
  };
  statusText.textContent = labels[state];
  portBadge.textContent = `:${port}`;
  detailText.textContent = detail;

  parent.postMessage(
    { pluginMessage: { type: 'ui-connection-status', state, port } },
    '*',
  );
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(port: number): void {
  clearReconnectTimer();
  const delay = Math.min(
    BASE_RECONNECT_DELAY_MS * Math.pow(1.5, reconnectAttempts),
    MAX_RECONNECT_DELAY_MS,
  );
  reconnectAttempts += 1;
  setStatus('reconnecting', `Retrying in ${Math.round(delay / 1000)}s...`, port);
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
  setStatus('connecting', url, port);

  const ws = new WebSocket(url);
  socket = ws;

  ws.addEventListener('open', () => {
    if (socket !== ws) {
      return;
    }
    reconnectAttempts = 0;
    setStatus('connected', url, port);
  });

  ws.addEventListener('message', (event) => {
    if (socket !== ws) {
      return;
    }
    try {
      const payload = JSON.parse(String(event.data));
      parent.postMessage(
        { pluginMessage: { type: 'bridge-request', payload } },
        '*',
      );
    } catch {
      setStatus('connected', 'Ignored invalid JSON frame', port);
    }
  });

  ws.addEventListener('close', () => {
    if (socket !== ws) {
      return;
    }
    socket = null;
    if (!manualClose) {
      scheduleReconnect(port);
    } else {
      setStatus('disconnected', 'Stopped', port);
    }
  });

  ws.addEventListener('error', () => {
    // WebSocket error is always followed by close; detail updated on close
  });
}

window.addEventListener('message', (event: MessageEvent<{ pluginMessage?: PluginToUiMessage }>) => {
  const pluginMessage = event.data?.pluginMessage;
  if (!pluginMessage) {
    return;
  }

  if (pluginMessage.type === 'ui-init') {
    const { port, minimized } = pluginMessage.payload;
    applyMinimizedState(minimized, false);

    if (!initialized) {
      initialized = true;
      portInput.value = String(port);
      connect();
    } else if (getTargetPort() !== port) {
      portInput.value = String(port);
      reconnectAttempts = 0;
      connect();
    }
    return;
  }

  if (pluginMessage.type === 'bridge-response') {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(pluginMessage.payload));
    }
  }
});

minimizeBtn.addEventListener('click', () => {
  applyMinimizedState(!isMinimized, true);
});

hideBtn.addEventListener('click', () => {
  parent.postMessage({ pluginMessage: { type: 'ui-hide-to-background' } }, '*');
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

// Apply local fallback immediately and ask sandbox for persisted clientStorage settings
portInput.value = String(readSavedPort());
applyMinimizedState(readSavedMinimized(), false);
parent.postMessage({ pluginMessage: { type: 'ui-ready' } }, '*');

// Fallback if ui-init does not arrive (e.g., standalone preview outside Figma)
window.setTimeout(() => {
  if (!initialized) {
    initialized = true;
    connect();
  }
}, 250);
