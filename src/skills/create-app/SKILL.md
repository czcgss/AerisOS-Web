---
name: create-app
description: Create, inspect, modify, validate, install, update, and uninstall Aeris extension apps when the user asks to build, add, extend, change, manage, or remove an app.
---

# Create an Aeris app

Use this skill only for extension applications that run through the Aeris App Runtime. Never edit the Aeris host source or register the App Studio as an App Tool.

## Required workflow

1. Translate the user's request into one focused application with a lowercase hyphenated id.
2. Design both surfaces before calling the tool:
   - Main is the complete resizable desktop application.
   - Activity is a purpose-built compact Agent workspace, not a scaled copy of Main.
3. Both surfaces must share state through the asynchronous Aeris App SDK. Follow the exact runtime contract and template below; do not invent API signatures.
4. Provide complete English and Chinese names, descriptions, and translation dictionaries.
5. Use semantic HTML, keyboard-accessible controls, responsive CSS, Aeris visual variables, and restrained motion.
6. Do not use network access, external assets, browser dialogs, browser storage, `window.parent`, or host DOM access.
7. Call `aeris_app_studio` with type `validate` and all source fields.
8. Review validation errors and correct the source. Never claim success from unvalidated code.
9. After validation succeeds, call `aeris_app_studio` with type `install` and the returned `draftId`.
10. Tell the user the installed app id and that it is available in Launcher and Agent Activity.

## Managing installed extension apps

Use `aeris_app_studio` with type `list` before managing an existing extension. To remove an app, call type `uninstall` with its exact `id`. Uninstall is destructive and always pauses for Aeris system approval. Never imply that approval was granted, never retry a denied uninstall, and never attempt to remove a bundled app. A successful uninstall closes every Main and Activity instance and permanently removes the app package and its saved state.

## Modifying an installed extension

Never use the Terminal or Files tools to discover an extension app implementation. Extension packages live in the Aeris App Runtime, not in the Linux filesystem.

1. Call `aeris_app_studio` with type `inspect` and the exact app `id`. With no `path`, it returns the complete validated manifest and every source file. Use `path` to reread one exact file when only a focused source is needed.
2. Preserve the app id and all package files. Modify only what the user's request requires, while bringing both Main and Activity into compliance when their shared behavior changes.
3. Increment the semantic version and call type `validate` with the complete revised source.
4. Correct every validation error. Then call type `update` with the returned `draftId`.
5. Update is a protected action and pauses for Aeris approval. Do not retry a denial. Successful update replaces the package, reloads any open Main and Agent Activity views, and preserves existing shared app state by default.

Never attempt to update a bundled app and never claim that source was inspected unless the `inspect` operation completed.

## Aeris design language contract

AerisOS styling is the default, not an optional theme. Unless the user explicitly requests a different visual direction, both Main and Activity must look native beside the built-in Aeris apps:

- Build a desktop application layout, not a web landing page. Main should use a compact toolbar/sidebar/content/status-bar hierarchy when those regions are useful. Activity must fill its available surface and expose only the task-focused controls appropriate to the Agent workspace.
- Use the runtime tokens `--surface`, `--surface-2`, `--text`, `--muted`, `--accent`, `--line`, `--shadow`, `--small-shadow`, `--inset`, `--font-ui`, and `--font-mono`. Do not invent an unrelated global palette, branded gradient background, or typography system.
- Use `var(--font-ui)` for interface copy and `var(--font-mono)` only for code, paths, counters, or terminal-like data. Default interface text is compact: 9–13px for controls and supporting copy, with larger type reserved for a clear page title or primary value.
- Use soft translucent surfaces, subtle depth, thin separators, 9–16px control/card radii, and the current system accent. Neumorphic depth is selective: use it for raised controls and focused surfaces, not on every row.
- Buttons must have hover, active, disabled, and `:focus-visible` states. Inputs must use Aeris surfaces and focus rings. Selection, empty, loading, and error states must be intentionally designed.
- Motion should normally complete in 120–220ms, change opacity/transform rather than layout, and remain restrained. Any animation or transition must include a `prefers-reduced-motion` fallback.
- Both views must respond to narrow sizes without clipped controls or scaled desktop UI. Avoid fixed full-window dimensions inside either surface.
- React to `Aeris.environment.subscribe` so locale, theme, and accent changes update without reopening the app. Never hard-code a light-only interface.

Before validation, compare Main and Activity against this contract. A technically functional app that looks like a generic webpage is incomplete.

## SDK rules

`Aeris.ready` is a Promise, not a callback-registration function. Start each Main and Activity script with `Aeris.ready.then(() => { ... })` or an async IIFE containing `await Aeris.ready`. Never write `Aeris.ready(...)`.

`Aeris.app.getState()`, `setState(...)`, and `patchState(...)` are asynchronous and return Promises. Always `await` them when their result or completion affects the next operation. Never treat the Promise returned by `getState()` as the state object. `Aeris.activity.openFullApp()` is asynchronous too.

Use this state pattern in both views:

```js
Aeris.ready.then(() => {
  let currentState = null;

  const normalizeState = value => ({
    items: Array.isArray(value?.items) ? value.items : [],
    // Normalize every other field owned by this app.
  });

  const render = state => {
    // Render only from the state argument. Do not call getState here.
  };

  Aeris.app.subscribe(nextState => {
    currentState = normalizeState(nextState);
    render(currentState);
  });

  Aeris.environment.subscribe(() => {
    // Reapply translations and environment-dependent presentation.
    if (currentState) render(currentState);
  });

  document.querySelector('[data-add]').onclick = async () => {
    const latest = normalizeState(await Aeris.app.getState());
    await Aeris.app.patchState({
      items: [...latest.items, createItem()],
    });
  };
});
```

Adapt the state field names to the application; do not copy `items` blindly. Register DOM handlers only after `Aeris.ready` resolves. Render from `Aeris.app.subscribe(state => ...)` so Main and Activity remain synchronized. Before a read-modify-write mutation, await the latest state instead of relying on a possibly stale closure. Mutations must produce a JSON-serializable object.

Use `Aeris.i18n.t(key)` for all visible copy. Use `Aeris.environment.subscribe` to re-render locale-, theme-, and accent-dependent presentation. Activity may call `await Aeris.activity.openFullApp()`.

## Pre-validation self-check

Before calling `validate`, inspect both JavaScript sources and correct every failure:

- Reject `Aeris.ready(`. Use `Aeris.ready.then(` or `await Aeris.ready`.
- Reject an unawaited `Aeris.app.getState()` used as an object, spread value, or collection source.
- Ensure every interactive control has a handler registered after readiness.
- Trace create, edit, toggle, delete, filter, and reset flows from the DOM event through the awaited state mutation and subscribed render.
- Ensure Main and Activity use the same state schema and neither keeps an independent authoritative copy.
- Ensure rejected SDK operations produce an in-app error state; never use browser dialogs.
- Ensure initial render comes from the state subscription, not from a fabricated empty state that can overwrite persisted data.

Every application must remain useful after refresh and must never expose native browser interaction as part of its UI.
