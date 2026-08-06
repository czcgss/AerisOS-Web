# Aeris WebOS

Aeris is an experimental browser-hosted operating-system research project. It combines a modular desktop shell with an actual 32-bit Alpine Linux guest running locally through [v86](https://github.com/copy/v86), plus an AI Agent that can call explicitly registered application tools.

The browser hosts the emulated hardware, compositor, windows, and local persistence. Linux supplies the process and filesystem runtime. Aeris applications consume system services rather than reaching into v86 directly.

> **Aeris is not a complete, general-purpose operating system for daily or production use.** It is a working research prototype for exploring how an operating system with AI integrated as a native system capability—not merely added as a chatbot—might evolve in the future.

## Project vision

Most current AI desktop products place an assistant on top of an existing operating system. Aeris explores a different model: applications expose explicit, structured capabilities to a system Agent; users control which applications the Agent may access; risky operations require approval; and tool activity remains visible as part of the operating-system interaction.

The project uses a real Linux guest so these ideas can be tested against processes, files, persistence, networking, and system state rather than only against static interface mockups. Its goal is to validate interaction models, permission boundaries, application tools, and Agent orchestration—not to replace macOS, Windows, or Linux distributions today.

Aeris remains under active development. Features may be incomplete, data formats can change, and compatibility is not guaranteed. It is not a hardened sandbox and should not be used with irreplaceable data or production secrets.

## Highlights

- Real x86 Linux guest running in WebAssembly, not a simulated terminal
- Installation gate, first-run setup assistant, desktop, Dock, launcher, menus, notifications, widgets, and window management
- Snapshot-based machine restoration through IndexedDB and separate window-session restoration
- Linux-backed Files, Terminal, Text Editor, Preview, Disk Utility, Computer, and System Monitor
- Calendar, Contacts, Reminders, Notes, Photos, Trash, Weather, Clock, and Calculator
- English and Simplified Chinese with importable JSON language packs
- Aeris AI with OpenAI-compatible providers, persistent conversations, per-application tool permissions, structured tool-call rendering, and approval for high-risk actions
- Native Aeris dialogs and clipboard behavior instead of browser prompts

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the runtime layers and application contract, and [design.md](design.md) for the visual direction.

## Requirements

- Node.js 20.19 or newer
- pnpm 11 (Corepack is recommended)
- A modern desktop browser with WebAssembly and IndexedDB
- About 300MB of free space for the Alpine installation image, plus space for browser snapshots

## Quick start

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm assets
pnpm dev
```

Open the local URL printed by Vite. `pnpm assets` downloads the official Alpine Linux 3.24.1 x86 standard image and verifies its SHA-256 checksum. The ISO is intentionally excluded from Git because it exceeds normal repository file limits.

The first boot installs and configures the guest before unlocking the desktop. Later loads restore the saved v86 snapshot when one is available.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm assets` | Download and verify the required Alpine ISO |
| `pnpm assets:check` | Verify that the runtime image is present and valid |
| `pnpm dev` | Validate assets and start the development server |
| `pnpm build` | Build the source shell without bundling the ignored ISO |
| `pnpm build:release` | Validate assets and create a complete local distribution |
| `pnpm preview` | Validate assets and preview the production build |
| `pnpm check` | Run the CI build check |

## AI Agent

Open Aeris AI, then configure an OpenAI-compatible base URL, API key, and model. Conversations are stored in the Aeris user data directory and mirrored to browser recovery storage. Application tools can be enabled or disabled under **AI Settings → Tools**.

High-risk operations, such as running terminal commands or moving files to Trash, require an Aeris approval dialog. This approval layer reduces accidental actions but is not a security boundary against malicious same-origin code or compromised dependencies.

Never commit provider credentials. Browser-side API keys are appropriate only for local development or trusted endpoints.

## Persistence and privacy

- v86 machine snapshots are compressed and stored in IndexedDB.
- Window state and lightweight recovery state use browser local storage.
- Calendar, contacts, reminders, notes, and AI conversations are local-first.
- Clearing site data removes the saved machine and Aeris application state.
- Weather and configured AI providers make external network requests; the Linux guest can use v86's supported networking path.

## Project structure

```text
src/kernel       lifecycle, service registry, event bus
src/platform     v86 machine, state store, serial bridge
src/services     stable operating-system APIs and Agent services
src/shell        desktop, setup assistant, widgets, window manager
src/apps         independently registered system applications
src/locales      built-in language packs
src/system       dependency composition and boot order
public/v86       vendored v86 runtime assets; downloaded ISO is ignored
scripts          reproducible development and asset tooling
docs             architecture documentation
```

## Language packs

Import a JSON file from **Settings → Language & Region**. It must contain `_code` and `_name`; missing keys fall back to English.

```json
{
  "_code": "fr",
  "_name": "Français",
  "files": "Fichiers",
  "settings": "Réglages"
}
```

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change. Report security issues according to [SECURITY.md](SECURITY.md), and review [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistributing a packaged build.

## License

No Aeris project license has been selected yet. A `LICENSE` file must be added before describing or distributing Aeris as open source. Third-party components remain governed by their own licenses.
