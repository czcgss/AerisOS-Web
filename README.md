<div align="center">
  <h1><img src="public/aeris.svg" width="64" height="64" alt="AerisOS logo" align="center">&nbsp;AerisOS</h1>
  <p><strong>An AI-native WebOS research project running a real Linux guest in the browser.</strong></p>
  <p>
    <a href="https://github.com/czcgss/AerisOS-Web/actions/workflows/ci.yml"><img src="https://github.com/czcgss/AerisOS-Web/actions/workflows/ci.yml/badge.svg?branch=develop" alt="CI status"></a>
    <a href="https://github.com/czcgss/AerisOS-Web/releases"><img src="https://img.shields.io/github/v/release/czcgss/AerisOS-Web?display_name=tag" alt="Latest release"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
    <img src="https://img.shields.io/badge/status-experimental-orange.svg" alt="Experimental status">
  </p>
</div>

AerisOS is a modular, browser-hosted operating-system environment built around an actual 32-bit Alpine Linux guest running locally through [v86](https://github.com/copy/v86). It combines a desktop shell, window manager, system applications, Linux-backed files and terminals, persistent machine state, and an Agent that can use structured application capabilities.

All Aeris-owned implementation code was written by AI through iterative product direction, review, and manual testing by a human. Third-party projects retain their original authorship and licenses.

> [!IMPORTANT]
> AerisOS is not a complete, general-purpose operating system and is not intended for daily or production use. It is an active research prototype for exploring how AI-native operating systems may evolve—and how far a complex system can be built through AI-directed software development.

## Why AerisOS exists

Most desktop AI products add an assistant on top of an existing operating system. AerisOS explores a different model: AI is a visible system capability with explicit context, application tools, permissions, approvals, activity history, and actionable results.

The project is designed to test questions such as:

- What changes when applications expose structured capabilities to a system Agent?
- Can users understand what the Agent sees, which App it is using, and what it changed?
- How should risky operations, persistence, context, and cross-App work be represented?
- Which responsibilities belong to the browser shell, the Linux guest, and the Agent layer?
- What are the strengths and limits of building system software primarily through AI-generated code?

Using a real Linux guest means these ideas can be evaluated against processes, filesystems, networking, terminals, and persistent machine state instead of static UI mockups.

## Current project status

| Area | Current state |
| --- | --- |
| Desktop environment | Functional shell, Dock, launcher, windows, menus, widgets, notifications, setup assistant, and session restoration |
| Linux runtime | Real Alpine Linux x86 guest running locally through v86/WebAssembly |
| Files and terminal | Linux-backed filesystem applications and independent interactive TTY sessions |
| Built-in applications | Eighteen modular system Apps, including Files, Calendar, Notes, Terminal, Weather, and system utilities |
| AI integration | Persistent conversations, App tools, context selection, approvals, interactive App workspace, and reusable result cards |
| Localization | English, Simplified Chinese, and importable JSON language packs |
| Maturity | Experimental; APIs and stored data can change without migration guarantees |
| Security | Research-grade only; not a hardened sandbox or secret-management environment |

Do not evaluate AerisOS with irreplaceable files, production credentials, or sensitive conversations. See [SECURITY.md](SECURITY.md) for the current trust boundaries.

## Highlights

- A real x86 Linux guest—not a simulated terminal or a collection of static App screens
- Installation gate and first-run system setup before the desktop becomes interactive
- Snapshot-based v86 machine restoration through IndexedDB
- Linux-backed Files, Terminal, Text Editor, Preview, Disk Utility, Computer, and System Monitor
- Native Linux TTY sessions with VT/ANSI rendering, signals, scrollback, selection, tab completion, and full-screen programs
- Calendar, Contacts, Reminders, Notes, Photos, Trash, Weather, Clock, and Calculator
- Native Aeris dialogs, menus, clipboard behavior, notifications, and window interactions
- English and Simplified Chinese, with fallback-based external language packs
- Aeris AI using OpenAI-compatible providers and persistent Pi Agent sessions
- Per-App tool registration, structured arguments, high-risk approval, interactive App activity, visible context, and reusable task results

## How it works

```text
Browser host
├── Aeris desktop shell
│   ├── window manager, Dock, menus, widgets, notifications
│   └── modular system applications
├── Aeris kernel and services
│   ├── lifecycle, event bus, settings, dialogs, persistence
│   ├── filesystem, command, process, metrics, and network services
│   └── Agent sessions, context, application tools, and approvals
└── v86 virtual computer
    ├── emulated x86 hardware and serial devices
    └── Alpine Linux guest
        ├── real processes and shell sessions
        ├── Linux home directories and files
        └── /mnt/aeris shared filesystem
```

The browser owns the shell, emulated hardware, and local persistence. Linux owns guest processes, shell behavior, and its filesystem. Applications consume stable Aeris services rather than calling v86 directly. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the runtime contracts and [design.md](design.md) for the visual direction.

## Requirements

- Node.js `22.20.0` or newer in the Node 22 line
- pnpm `11.9.0`
- A modern desktop browser with WebAssembly and IndexedDB
- Approximately 300 MB of free space for the Alpine image, plus browser snapshot storage

Node 22 is the version used by CI. New, unsupported Node major versions may be incompatible with Corepack or the current dependency toolchain.

## Quick start

```bash
git clone https://github.com/czcgss/AerisOS-Web.git
cd AerisOS-Web
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm install --frozen-lockfile
pnpm assets
pnpm dev
```

Open the local URL printed by Vite.

If you prefer not to use Corepack, install the pinned package manager directly:

```bash
npm install --global pnpm@11.9.0
```

`pnpm assets` downloads the official Alpine Linux 3.24.1 x86 standard image, reports download progress, and verifies its SHA-256 checksum. The ISO is intentionally excluded from Git.

### First installation and later restores

The first launch boots Alpine, configures the `aeris` account and system services, and saves the first recoverable machine snapshot before unlocking the desktop. This can take longer than later starts.

After installation, reloading the page restores the latest v86 snapshot and window session. It does not reinstall Linux unless browser site data or Aeris persisted state has been removed. The installation screen remains active while either installation or restoration is in progress so a partially initialized desktop cannot be used.

## Development commands

| Command | Purpose |
| --- | --- |
| `pnpm assets` | Download and verify the required Alpine ISO |
| `pnpm assets:check` | Check whether the correct runtime image exists |
| `pnpm dev` | Validate runtime assets and start the Vite development server |
| `pnpm check` | Run the same production build check used by CI |
| `pnpm build` | Build the WebOS shell without bundling the ignored ISO |
| `pnpm build:release` | Validate the ISO and build a complete local distribution |
| `pnpm preview` | Validate assets and preview the production build |

## Aeris AI

Open **Aeris AI → Settings → Model** and configure an OpenAI-compatible base URL, API key, and model. Model credentials are intended only for local development or trusted endpoints.

The Agent is integrated with operating-system concepts rather than presented only as a chat window:

- Apps register validated tools that can be enabled or disabled by the user.
- The selected window, resource, file, date, or text can become explicit Agent context.
- High-risk actions, including terminal commands and destructive file operations, require Aeris approval.
- The Activity workspace hosts live, task-focused App surfaces that the user and Agent can operate together.
- Active Apps can be opened, switched, closed, or continued in their full desktop window.
- Tool cards show the application, action, state, risk, parameters, and output without replacing the conversation.
- Results preserve created, queried, modified, moved, or deleted resources with App-specific actions.
- Conversations and Agent state persist locally and recover after refresh.

Approval reduces accidental actions but is not a security boundary against malicious same-origin code or compromised dependencies. Never commit API keys or use production secrets in the browser client.

## Persistence and data

| Data | Storage |
| --- | --- |
| Complete v86 machine checkpoints | Compressed snapshots in IndexedDB |
| Window positions and open-App session | Browser local storage |
| Calendar, contacts, reminders, notes, and Agent data | Aeris local-first user-data services with recovery storage |
| Linux home directories and installed guest software | Persisted as part of the machine snapshot |

Clearing site data removes the saved machine, App data, and desktop session. Weather and configured model providers make external requests; the Linux guest uses the networking capabilities supported by v86.

## Project structure

```text
src/kernel       service registry, event bus, and lifecycle
src/platform     v86 machine, snapshots, and host/guest transport
src/services     stable operating-system and Agent APIs
src/shell        desktop, setup assistant, widgets, and window manager
src/apps         independently registered system applications
src/locales      built-in language packs
src/system       dependency composition and boot order
public/v86       pinned emulator assets; downloaded ISO is ignored
scripts          asset and development tooling
docs             architecture documentation
```

## Language packs

Import a JSON file from **Settings → Language & Region**. A pack must define `_code` and `_name`; missing strings fall back to English.

```json
{
  "_code": "fr",
  "_name": "Français",
  "files": "Fichiers",
  "settings": "Réglages"
}
```

## Troubleshooting

### `Missing or invalid runtime asset`

Run `pnpm assets`. If a partial download was interrupted, the script removes its temporary file and starts a verified download on the next run.

### pnpm or Corepack fails before running a command

Use Node 22.20, then activate pnpm 11.9.0 with Corepack or install that pnpm version directly with npm. The repository pins pnpm in `package.json` and CI uses the same versions.

### The page shows installation or restoration for a long time

Expand the installation details and copy the latest system message before reporting the issue. Include whether this was the first installation or a snapshot restore. Do not include credentials, conversations, or private filesystem content.

### A clean installation is required

Use the recovery screen's erase-and-reinstall action or clear the site's stored data. This permanently removes the local machine snapshot and Aeris application data.

## Contributing

Contributions are welcome, but AerisOS uses a strict integration workflow:

1. Read [CONTRIBUTING.md](CONTRIBUTING.md).
2. Create a focused branch from the latest `develop`.
3. Run `pnpm check` and manually verify affected system behavior.
4. Open the pull request against `develop`, never directly against `main`.

Useful reports include the browser version, host OS, first-install or restored-snapshot state, minimal reproduction steps, and sanitized logs. UI pull requests should include screenshots without private data.

For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue. Third-party redistribution requirements are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

AerisOS is released under the [MIT License](LICENSE). Third-party components remain governed by their own licenses and notices.
