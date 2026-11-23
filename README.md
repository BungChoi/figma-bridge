# Figma Local Bridge (`figma-bridge`)

Self-hosted, local-only TypeScript MCP bridge connecting **Gemini CLI** to **Figma Desktop** on a **Free/Starter Figma account** — no Figma Dev Mode, paid seat, personal access tokens, or external network traffic required.

## Architecture

```text
Gemini CLI <--(stdio MCP JSON-RPC)--> @figma-bridge/mcp-server <--(ws://localhost:38451)--> Figma Plugin UI <--(postMessage)--> Figma Sandbox
```

- **Loopback only:** The WebSocket hub binds strictly to `127.0.0.1` (default port `38451`, configurable via `FIGMA_BRIDGE_PORT`). In `packages/figma-plugin/manifest.json`, `networkAccess.allowedDomains` is `["none"]` and only `ws://localhost:38451` is permitted in `devAllowedDomains`.
- **Clean stdio:** All MCP server diagnostics log to `stderr` so `stdout` stays reserved for MCP JSON-RPC.
- **Read-only MCP tools:**
  1. `get_bridge_status` — Connection state, active file name, page name, and selection summary.
  2. `get_selection` — Compact serialized node trees (`layout`, `bounds`, `fills`, `strokes`, `effects`, `text`, `cornerRadius`) for the currently selected layers (`depth`, `includeHidden`).
  3. `get_node` — Serialized subtree for a specific `nodeId`.
  4. `export_node_image` — Export a `nodeId` (or the current selection) as a `PNG` image content block (`scale` default `2`) or raw `SVG` markup.
  5. `get_local_tokens` — Local paint styles, text styles, effect styles, and local Figma variables/collections.

## Workspace Layout

- `packages/shared` (`@figma-bridge/shared`) — Shared WebSocket protocol envelopes and DTO types.
- `packages/mcp-server` (`@figma-bridge/mcp-server`) — MCP stdio server (`McpServer`) + WebSocket bridge hub.
- `packages/figma-plugin` (`@figma-bridge/figma-plugin`) — Figma Desktop development plugin (`manifest.json`, QuickJS sandbox `code.ts`, inline `ui.html`).

## Prerequisites

- **Node.js** >= 20 and **npm** >= 10
- **Figma Desktop** app (works on Free/Starter accounts; Dev Mode is **not** required)
- **Can edit** permission on the target Figma file *(Figma blocks standard design plugins on view-only files — if a file is view-only, duplicate it to your Drafts first)*

## 1. Clone, Build & Test

```bash
git clone https://github.com/BungChoi/figma-bridge.git
cd figma-bridge
npm install
npm run typecheck && npm run build && npm test
```

This produces:
- `packages/mcp-server/dist/index.js` — executable MCP server entrypoint
- `packages/figma-plugin/dist/code.js` — Figma plugin sandbox bundle
- `packages/figma-plugin/dist/ui.html` — self-contained Figma plugin UI

## 2. Register in Gemini CLI (`~/.gemini/settings.json`)

Edit `~/.gemini/settings.json` (create it if missing, or merge `"figma-bridge"` into your existing `"mcpServers"` object without removing other servers). Replace `/absolute/path/to/figma-bridge` with the path where you cloned this repo:

```json
{
  "mcpServers": {
    "figma-bridge": {
      "command": "node",
      "args": [
        "/absolute/path/to/figma-bridge/packages/mcp-server/dist/index.js"
      ]
    }
  }
}
```

Optional custom WebSocket port via `env`:

```json
{
  "mcpServers": {
    "figma-bridge": {
      "command": "node",
      "args": [
        "/absolute/path/to/figma-bridge/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "FIGMA_BRIDGE_PORT": "38451"
      }
    }
  }
}
```

> If you change the port from `38451`, also update `devAllowedDomains` in `packages/figma-plugin/manifest.json` (`ws://localhost:<PORT>`) and re-import the manifest in Figma Desktop.

## 3. Import & Run the Plugin in Figma Desktop

1. Open **Figma Desktop** and open a file where you have **Can edit** access.
2. Go to **Plugins -> Development -> Import plugin from manifest...**
3. Select `<repo-root>/packages/figma-plugin/manifest.json`.
4. Launch **Plugins -> Development -> Figma Local Bridge -> Open Bridge UI** (or **Run in Background (No Popup)** to connect without a floating window).
5. Confirm the plugin window shows a green **Connected** indicator (`ws://localhost:38451`). You can click **`–`** to minimize it into a compact bar or **`Hide`** to move it to the background.

> **Keep the plugin running** while working with Gemini CLI — clicking `X` on the popup (or **Cancel** on the background pill) terminates the plugin sandbox and UI WebSocket in Figma, disconnecting the bridge. If you close it by mistake, relaunch it quickly on macOS with **`Option + Cmd + P`** (*Run last plugin*) or via **Plugins -> Development -> Figma Local Bridge**.

## 4. Verify & Use

1. Start a new `gemini` session in your terminal and run `/mcp` to confirm `figma-bridge` is green with all 5 tools listed.
2. In Figma Desktop (normal **Design** mode — no Dev Mode needed), click/select any frame or component on the canvas.
3. Ask Gemini CLI to inspect it, for example:
   > `Check get_bridge_status, then call get_selection and export_node_image for the selected frame and implement the UI.`
4. *(Optional)* To inspect a node by ID with `get_node` without selecting it first, right-click the layer in Figma -> **Copy/Paste as -> Copy link to selection** (`Cmd/Ctrl + L`), grab `?node-id=12-34` from the URL, and replace `-` with `:` (`"12:34"`).

## Troubleshooting

- **`Figma Local Bridge` does not appear under `Plugins -> Development`:** Make sure you ran **Import plugin from manifest...** and selected `packages/figma-plugin/manifest.json` first.
- **`Plugins -> Development` is disabled on a file:** The file is view-only. Duplicate it (or copy the frames) into your Drafts so you have `Can edit` permission.
- **`PLUGIN_NOT_CONNECTED` error from MCP tools:** Ensure **Figma Local Bridge** is open in the active Figma tab and shows **Connected**. If you switched to another Figma file tab, run the plugin in that tab.
- **`PORT_IN_USE` (`EADDRINUSE`) on port `38451`:** Only one `figma-bridge` MCP server instance can bind port `38451` at a time. Close extra Gemini CLI sessions using the same port, or configure `FIGMA_BRIDGE_PORT`.
- **Manifest validation error on `devAllowedDomains`:** Figma rejects IP literals like `127.0.0.1` in `manifest.json`; keep `ws://localhost:<PORT>` in `devAllowedDomains`.
