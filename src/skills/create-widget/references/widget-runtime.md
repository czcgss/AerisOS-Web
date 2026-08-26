# Internal Future Widget Runtime reference

This reference belongs to the `create-widget` skill. It is not public developer documentation. The Skill must load it before generating or modifying a widget.

## Package contract

```js
{
  manifest: {
    formatVersion: 1,
    sdkVersion: "1",
    id: "today-widget",
    version: "1.0.0",
    name: { en: "Today", zh: "今天" },
    description: { en: "Today's schedule", zh: "今天的日程" },
    icon: "calendar",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    permissions: ["storage", "calendar.read", "app.open"],
    refresh: { mode: "event" },
    initialState: {},
    entry: { html: "widget.html", css: "widget.css", script: "widget.js" }
  },
  files: {
    "widget.html": "<main></main>",
    "widget.css": "main { height: 100%; }",
    "widget.js": "FutureWidget.ready.then(() => {});",
    "locales/en.json": "{}",
    "locales/zh.json": "{}"
  }
}
```

Packages contain at most 32 text files and 384 KiB. Supported sizes are `small`, `medium`, and `large`. English and Chinese metadata and locale files are mandatory.

HTML cannot embed scripts, frames, objects, links, or external resources. CSS cannot load remote resources. Scripts cannot use browser persistence, networking, browser dialogs, cookies, parent-window APIs, or host DOM access.

## SDK v1

Wait for `FutureWidget.ready`, then use only declared capabilities:

- `FutureWidget.state.get()`, `set(value)`, `patch(value)`, and `subscribe(listener)` require `storage`.
- `FutureWidget.data.get(source)` and `subscribe(source, listener)` support `calendar`, `reminders`, `weather`, `metrics`, and `music`, guarded by their matching `.read` permission.
- `FutureWidget.music.play(track)`, `pause()`, `toggle()`, `next()`, `previous()`, `seek(seconds)`, `setVolume(value)`, `toggleShuffle()`, `cycleRepeat()`, and `refresh()` require `music.control`.
- `FutureWidget.apps.open(appId, params)` requires `app.open`.
- `FutureWidget.environment.current` and `subscribe(listener)` expose locale, strings, the compatibility theme base mode, `themeId`, `themeVersion`, semantic `tokens`, resolved CSS `variables`, accent, size, and visibility.
- `FutureWidget.lifecycle.subscribe(listener)` receives `pause`, `resume`, and configured interval `refresh` events.
- `FutureWidget.errors.subscribe(listener)` reports rejected subscriptions and other background SDK failures. Render these failures inside the widget.
- `FutureWidget.i18n.t(key)` resolves package translations.

Interval refresh is clamped to 60–3600 seconds and pauses while the widget is not visible. Prefer event subscriptions over polling.

For a live music widget, declare `music.read` and subscribe to `music`. Add `music.control` only when the widget exposes playback controls. Main Music, Agent Activity, and every widget use the same MusicService player, so never create an `<audio>` element or a second playback engine.

```js
FutureWidget.ready.then(() => {
  FutureWidget.errors.subscribe(error => renderError(error.message));
  FutureWidget.data.subscribe('music', snapshot => renderMusic(snapshot));
});
```

## Widget behavior and design

- The system owns the outer card, drag handle, placement, size, removal, and gallery presentation. Generate content only.
- A widget is glanceable, not a miniature full application.
- Avoid scrolling in small and medium sizes. Keep one primary action and open the full app for complex work.
- Use the supplied Future font, semantic colors, radii, material, accent, and active installable theme. Do not create an unrelated global surface.
- React to size, locale, theme, accent, visibility, and reduced motion.
- Provide loading, empty, error, and stale-data states.
- Do not simulate data. Subscribe to an allowed system source or use persistent widget state.
- Keep hidden widgets idle and clean up subscriptions when appropriate.

The eventual `create-widget` Skill must validate a complete package before installation and must never modify `DesktopWidgets.js` to add a generated widget.
