---
name: create-app
description: Create, inspect, modify, validate, install, update, and uninstall Future extension apps when the user asks to build, add, extend, change, manage, or remove an app.
---

# Create a Future app

Use this skill only for extension applications that run through the Future App Runtime. Never edit the Future host source or register App Studio as an App Tool. The runtime reference bundled with this skill is mandatory; do not invent package fields or SDK signatures.

## Required widget-extension clarification

Before drafting a new app, determine whether the user explicitly requested or explicitly rejected desktop widget extension support. If neither intent is present in the user's request, you MUST call `query_user` once with topic `app-widget-extension` and wait for the answer. Do not infer the choice from the app category, even when a widget seems useful or unnecessary. Do not call `query_user` for app inspection, modification, update, or uninstall, and do not call it when the user already made the choice.

Treat the structured `widgetExtension` result as authoritative for the rest of the task. When it is false, do not invent or advertise widget capabilities. When it is true, follow the runtime contract for declaring a widget provider; if that contract is unavailable, do not claim widget support was implemented.

## Create and install

1. Translate the request into one focused application with a lowercase hyphenated id.
2. Design Main as the complete desktop application and Activity as a compact, task-focused Agent surface. Do not scale Main into Activity.
3. Use one shared state schema through the asynchronous Future SDK.
4. Provide complete English and Chinese metadata and translation dictionaries.
5. Implement every visible control and all loading, empty, error, disabled, hover, active, and focus states.
6. Call `future_app_studio` with type `validate` and the complete package.
7. Correct every validation error. Never claim success from unvalidated code.
8. Call type `install` with the returned `draftId`.
9. Report the installed app id and its availability in Launcher and Agent Activity.

## Inspect and update

Never use Terminal or Files to discover an extension implementation. Extension packages live in App Runtime, not Linux.

1. Call type `list`, then type `inspect` with the exact app id. Inspect the complete package unless the change is isolated to one known file.
2. Preserve the id and every package file; modify only what the request requires.
3. Keep Main and Activity on the same state schema and update both when shared behavior changes.
4. Increment the semantic version and validate the complete revised package.
5. Call type `update` with the returned `draftId`. Update requires Future approval and preserves state by default.

Never update a bundled app, retry denied approval, or claim source was inspected when inspection failed.

## Uninstall

Call type `list`, then type `uninstall` with the exact id. Uninstall is destructive and requires Future approval. Never retry denial or remove a bundled app. Successful uninstall closes its surfaces and removes its package and state.

## Completion gate

Before validation, follow the bundled runtime reference and trace every interaction from DOM event through the awaited SDK operation to the subscribed render. A visually plausible surface with incomplete behavior is not complete.
