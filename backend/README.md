# AerisOS backend

The backend is an optional host-side capability service. AerisOS still boots and
runs without it; capabilities that require native host processes, such as
Browser Use, connect through this service when available.

## Boundaries

```text
Aeris Agent -> registered Aeris tool -> frontend service -> HTTP API
                                                    -> Browser Use MCP --+
Aeris Browser App <-> screenshot/input API -> Chromium CDP <------------+
Skill ---------------------------- usage policy and workflow only
```

- `src/browser/` owns browser-automation contracts and the Browser Use adapter.
- `src/mcp/` owns the reusable stdio MCP client.
- `src/http/` owns HTTP parsing and response helpers.
- `src/config.js` is the only place that reads environment configuration.
- Chromium is started lazily on the first Browser navigation.
- Chromium runs headlessly by default, so no extra host browser window appears.
- Browser Use is started lazily on the first explicit Agent tool call and
  connects to the same Chromium CDP session used by the Browser App.

The Browser App renders the Chromium CDP screencast over WebSocket and forwards
pointer, keyboard, scroll, history, and navigation input through the backend.
Frames are acknowledged immediately and stale frames are dropped under
backpressure. It no longer embeds external pages in an iframe. The Agent never receives a generic Node.js
execution endpoint. Only allowlisted browser operations are exposed. Browser
interactions that can submit or mutate remote data remain protected Aeris tools
and require user approval.

## Development

The normal development command starts both the backend and Vite:

```bash
pnpm dev
```

Use `pnpm backend:dev` and `pnpm dev:frontend` in separate terminals when the
two processes need to be inspected independently.

Vite proxies `/api` to `http://127.0.0.1:4318`. Copy `.env.example` to `.env`
only when configuration changes are needed. Browser Use itself is not bundled;
by default the backend launches its official local MCP server with:

```bash
uvx --from browser-use[cli] browser-use --mcp
```

The server binds to loopback and accepts configured local origins only.
