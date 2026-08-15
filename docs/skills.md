# Aeris Agent Skills

Aeris skills are separate from App Tools. App Tools represent permissions to operate installed applications. Skills provide specialized instructions and may expose native tools only after the skill is loaded for a matching task.

The Agent initially receives the enabled skill catalog and `aeris_load_skill`. Loading a skill injects its complete instructions into the conversation and makes its owned tools available to that conversation. Pi's next-turn context hook refreshes the tool snapshot during the same Agent run.

```text
Enabled skill catalog
        ↓
aeris_load_skill
        ↓
Skill instructions + owned tools
        ↓
Next Pi Agent turn
```

Disabling a skill removes it from the catalog and removes its tools from every conversation. Imported Markdown skills contain instructions only; browser code cannot introduce native tools. Native tools are trusted Aeris modules bundled with the system.

## create-app

The built-in `create-app` skill owns `aeris_app_studio`. App Studio does not appear in the App Tool permission list and is unavailable until this skill is loaded. It can inspect package source, validate, install, update, list, and uninstall user extension apps without accessing the Linux filesystem. Update and uninstall use the Aeris protected-action approval flow and cannot alter bundled apps. Updating preserves the extension's shared state by default.

App Studio first validates a draft, then installs that exact validated draft by id. Validation checks the package format, both application views, English and Chinese locales, shared-state SDK usage, JavaScript syntax, package limits, and restricted browser APIs.
