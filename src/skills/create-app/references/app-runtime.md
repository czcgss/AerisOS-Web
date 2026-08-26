# Internal Future App Runtime reference

This reference is part of the `create-app` skill and is loaded for Agent use. Follow it exactly.

## Package contract

Produce one JSON-compatible object:

```js
{
  manifest: {
    formatVersion: 1,
    sdkVersion: "1",
    id: "example-app",
    version: "1.0.0",
    name: { en: "Example", zh: "示例" },
    description: { en: "Example app", zh: "示例应用" },
    icon: "package",
    color: "aqua",
    singleInstance: true,
    permissions: ["storage"],
    initialState: {},
    window: { width: 760, height: 540, minWidth: 420, minHeight: 320 },
    views: {
      main: { html: "main/index.html", css: "main/style.css", script: "main/app.js" },
      activity: { html: "activity/index.html", css: "activity/style.css", script: "activity/app.js" }
    }
  },
  files: {
    "locales/en.json": "{}",
    "locales/zh.json": "{}",
    "main/index.html": "<main></main>",
    "main/style.css": "main { height: 100%; }",
    "main/app.js": "Future.ready.then(() => {});",
    "activity/index.html": "<main></main>",
    "activity/style.css": "main { height: 100%; }",
    "activity/app.js": "Future.ready.then(() => {});"
  }
}
```

Ids contain lowercase letters, numbers, and hyphens. Versions use semantic versioning. English and Chinese metadata and locale files are mandatory. A package may contain at most 48 text files and 512 KiB. Shared state may contain at most 128 KiB and must be JSON-serializable.

HTML cannot contain scripts, frames, objects, embeds, links, or base elements. CSS cannot import or load remote resources. Scripts cannot use network APIs, browser storage, browser dialogs, cookies, `window.parent`, `window.top`, `window.opener`, or `window.open`.

## Surface contract

- Main is a complete resizable desktop application.
- Activity is a separately composed task surface for the Agent workspace, not a screenshot, scaled Main view, or static summary.
- Both surfaces share one authoritative state object. Never create independent Main and Activity stores.
- Activity may expose fewer controls but must remain functional and live.
- Both surfaces must react to locale, theme, and accent changes without reopening.

## SDK v1

`Future.ready` is a Promise. Start each script with `Future.ready.then(() => { ... })` or await it inside an async function. Never call `Future.ready(...)`.

Available APIs:

```js
await Future.ready;

const state = await Future.app.getState();
await Future.app.setState(nextState);
await Future.app.patchState(partialState);

const unsubscribeState = Future.app.subscribe(nextState => render(nextState));
const unsubscribeEnvironment = Future.environment.subscribe(environment => renderEnvironment(environment));

const label = Future.i18n.t('title');
await Future.activity.openFullApp();
```

`getState`, `setState`, `patchState`, and `openFullApp` return Promises. Await operations when completion affects the next step. `Future.app.subscribe` receives state changes from every mounted surface.

The environment contains `appId`, `view`, `locale`, `strings`, the compatibility `theme` base mode, `themeId`, `themeVersion`, the complete semantic `tokens` object, resolved CSS `variables`, `accent`, and the Activity target. Theme packages can change at runtime; always subscribe instead of reading the environment only once.

Use this mutation pattern:

```js
Future.ready.then(() => {
  let currentState = null;

  const normalizeState = value => ({
    items: Array.isArray(value?.items) ? value.items : []
  });

  const render = state => {
    // Render only from the supplied normalized state.
  };

  Future.app.subscribe(next => {
    currentState = normalizeState(next);
    render(currentState);
  });

  Future.environment.subscribe(() => {
    if (currentState) render(currentState);
  });

  document.querySelector('[data-add]').onclick = async () => {
    const latest = normalizeState(await Future.app.getState());
    await Future.app.patchState({ items: [...latest.items, createItem()] });
  };
});
```

Adapt field names instead of copying `items` blindly. Register handlers only after readiness. Render from state subscription. Before read-modify-write, fetch the latest state instead of trusting a stale closure. Show rejected operations as an in-app error.

## Future design contract

Future styling is the default unless the user explicitly asks for another direction.

- Build a compact desktop hierarchy, not a landing page. Use toolbar, sidebar, content, and status regions only when useful.
- Use `--surface`, `--surface-2`, `--text`, `--muted`, `--accent`, `--line`, `--positive`, `--warning`, `--danger`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--window-radius`, `--glass-blur`, `--font-ui`, and `--font-mono`. These values belong to the active installable system theme; never replace them with a separate app-wide palette.
- Do not invent an unrelated global palette, branded gradient background, or typography system.
- Use `var(--font-ui)` for UI text and `var(--font-mono)` only for code, paths, counters, or terminal data.
- Use compact 9–13px control and supporting text. Reserve large type for a clear page title or primary value.
- Prefer soft translucent surfaces, thin separators, subtle depth, 9–16px radii, and the system accent.
- Provide hover, active, disabled, and `:focus-visible` states for controls.
- Keep motion around 120–220ms and animate opacity or transform rather than layout. Include reduced-motion behavior.
- Respond to narrow surfaces without clipping or scaling a fixed desktop canvas.
- Implement intentional loading, empty, selection, and error states.

## Pre-validation checks

- Reject `Future.ready(`.
- Reject an unawaited `Future.app.getState()` used as an object, spread value, or collection.
- Verify every interactive element has a handler registered after readiness.
- Trace create, edit, toggle, delete, filter, and reset from DOM event to awaited state mutation and subscribed render.
- Verify Main and Activity normalize the same state schema.
- Verify rejected SDK calls render an in-app error and never invoke browser UI.
- Verify the initial render comes from subscription and cannot overwrite persisted state with a fabricated empty value.
- Verify refresh retains data and every visible feature remains functional.
