# Aeris App Package and SDK

An Aeris extension is a UTF-8 JSON document with the `.aerisapp` extension. The document contains a validated manifest and text-only application files. It must provide two views:

- `main`: the complete application shown in a normal Aeris window.
- `activity`: a purpose-built view shown in the Agent Activity workspace.

Both views run in isolated sandbox frames and share one persistent state object through the Aeris App SDK. Extension code has no direct access to the Aeris DOM, browser storage, network, or Linux guest.

## Package shape

```json
{
  "manifest": {
    "formatVersion": 1,
    "sdkVersion": "1",
    "id": "example-app",
    "version": "1.0.0",
    "name": { "en": "Example", "zh": "示例" },
    "description": { "en": "Example app", "zh": "示例应用" },
    "icon": "package",
    "color": "aqua",
    "singleInstance": true,
    "permissions": ["storage"],
    "initialState": {},
    "window": { "width": 760, "height": 540, "minWidth": 420, "minHeight": 320 },
    "views": {
      "main": { "html": "main/index.html", "css": "main/style.css", "script": "main/app.js" },
      "activity": { "html": "activity/index.html", "css": "activity/style.css", "script": "activity/app.js" }
    }
  },
  "files": {
    "locales/en.json": "{\"title\":\"Example\"}",
    "locales/zh.json": "{\"title\":\"示例\"}",
    "main/index.html": "<main></main>",
    "main/style.css": "main { height: 100%; }",
    "main/app.js": "Aeris.ready.then(() => {});",
    "activity/index.html": "<main></main>",
    "activity/style.css": "main { height: 100%; }",
    "activity/app.js": "Aeris.ready.then(() => {});"
  }
}
```

Package ids use lowercase letters, numbers, and hyphens. Versions use semantic versioning. English and Chinese metadata and locale files are required. Packages are limited to 48 files and 512 KiB; shared state is limited to 128 KiB.

## SDK v1

The SDK is available as the immutable global `Aeris`. Application code should wait for `Aeris.ready` before rendering or accessing state.

```js
await Aeris.ready;

const state = await Aeris.app.getState();
await Aeris.app.setState({ ...state, count: 1 });
await Aeris.app.patchState({ count: 2 });

const unsubscribeState = Aeris.app.subscribe(nextState => render(nextState));
const unsubscribeEnvironment = Aeris.environment.subscribe(environment => applyTheme(environment));

const label = Aeris.i18n.t('title');
await Aeris.activity.openFullApp();
```

`Aeris.app.subscribe` receives updates from every mounted surface of that app, so the main window and Agent Activity view remain synchronized without running duplicate application state.

The current environment contains `appId`, `view`, `locale`, `strings`, `theme`, `accent`, and the Activity target. The host updates it when the user changes language or appearance.

## Native design tokens

The runtime supplies the AerisOS design system to both views. Extension CSS should use these tokens instead of defining an unrelated application-wide palette:

- Colors: `--surface`, `--surface-2`, `--text`, `--muted`, `--accent`, `--line`, `--light`, `--dark`
- Depth: `--shadow`, `--small-shadow`, `--inset`
- Typography: `--font-ui`, `--font-mono`

The tokens update for light/dark appearance and the selected system accent. Main should resemble a compact native desktop application; Activity is a separately composed, task-focused view. If custom motion is used, provide a `prefers-reduced-motion` fallback.
