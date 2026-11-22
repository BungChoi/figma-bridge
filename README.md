# Figma Local Bridge (`figma-bridge`)

Self-hosted, local-only TypeScript MCP bridge connecting **Gemini CLI** to **Figma Desktop** on a Free/Starter Figma account — no Figma Dev Mode, paid seat, personal access tokens, or external network traffic required.

## Architecture

```text
Gemini CLI <--(stdio MCP JSON-RPC)--> @figma-bridge/mcp-server <--(ws://127.0.0.1:38451)--> Figma Plugin UI <--(postMessage)--> Figma Sandbox
```

- **Localhost only:** The WebSocket hub binds strictly to `127.0.0.1` (default port `38451`, configurable via `FIGMA_BRIDGE_PORT`).
- **Clean stdio:** All MCP server diagnostics log to `stderr` so `stdout` remains reserved for MCP JSON-RPC.
- **Read-only MVP tools:**
  1. `get_bridge_status` — Connection status, active file name, page name, and selection summary.
  2. `get_selection` — Serialized node trees (`layout`, `bounds`, `fills`, `strokes`, `effects`, `text`, `cornerRadius`) for current selection (`depth`, `includeHidden`).
  3. `get_node` — Serialized subtree for any `nodeId`.
  4. `export_node_image` — Export a `nodeId` (or current selection) as a `PNG` image content block (`scale` default `2`) or raw `SVG` markup.
  5. `get_local_tokens` — Local paint styles, text styles, effect styles, and local Figma variables/collections.

## Workspace Layout

- `packages/shared` (`@figma-bridge/shared`) — Shared WebSocket protocol envelopes and DTO types.
- `packages/mcp-server` (`@figma-bridge/mcp-server`) — MCP stdio server (`McpServer`) + WebSocket bridge hub.
- `packages/figma-plugin` (`@figma-bridge/figma-plugin`) — Figma Desktop development plugin (`manifest.json`, QuickJS sandbox `code.ts`, inline `ui.html`).

## Build, Typecheck & Test

Requirements: Node.js >= 20, npm >= 10.

```bash
npm install
npm run typecheck && npm run build && npm test
```

Build outputs:
- `packages/mcp-server/dist/index.js` (executable MCP server entrypoint)
- `packages/figma-plugin/dist/code.js` (Figma plugin sandbox bundle)
- `packages/figma-plugin/dist/ui.html` (self-contained Figma plugin UI)

## Setup in Figma Desktop

1. Open **Figma Desktop** and open any `.fig` or design file.
2. Go to **Plugins -> Development -> Import plugin from manifest...**
3. Select:
   ```text
   /Users/choi/Disk/development/project/figma-bridge/packages/figma-plugin/manifest.json
   ```
4. Launch the plugin via **Plugins -> Development -> Figma Local Bridge**.
   - The plugin UI connects automatically to `ws://127.0.0.1:38451` (you can adjust the port in the UI if `FIGMA_BRIDGE_PORT` is changed; remember to update `devAllowedDomains` in `manifest.json` if using a non-default port).

## Register in Gemini CLI (`~/.gemini/settings.json`)

Add `figma-bridge` under `mcpServers` in `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "figma-bridge": {
      "command": "node",
      "args": [
        "/Users/choi/Disk/development/project/figma-bridge/packages/mcp-server/dist/index.js"
      ]
    }
  }
}
```

If you need a custom WebSocket port, pass `FIGMA_BRIDGE_PORT` via `env`:

```json
{
  "mcpServers": {
    "figma-bridge": {
      "command": "node",
      "args": [
        "/Users/choi/Disk/development/project/figma-bridge/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "FIGMA_BRIDGE_PORT": "38451"
      }
    }
  }
}
```

Verify in Gemini CLI by running `/mcp` after starting `gemini`, then open the **Figma Local Bridge** plugin in Figma Desktop and select a frame to inspect.
