<div align="center">
  <h1><img src="public/future.svg" width="64" height="64" alt="FutureOS logo" align="center">&nbsp;FutureOS</h1>
  <p><strong>An AI-native WebOS research project running a real Linux guest in the browser.</strong></p>
  <p>
    <a href="https://github.com/czcgss/FutureOS-Web/actions/workflows/ci.yml"><img src="https://github.com/czcgss/FutureOS-Web/actions/workflows/ci.yml/badge.svg?branch=develop" alt="CI status"></a>
    <a href="https://github.com/czcgss/FutureOS-Web/releases"><img src="https://img.shields.io/github/v/release/czcgss/FutureOS-Web?display_name=tag" alt="Latest release"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
    <img src="https://img.shields.io/badge/status-experimental-orange.svg" alt="Experimental status">
  </p>
</div>

FutureOS (Chinese name: **伏秋**) is a modular, browser-hosted operating-system environment built around an actual 32-bit Alpine Linux guest running locally through [v86](https://github.com/copy/v86). It combines a desktop shell, window manager, system applications, Linux-backed files and terminals, persistent machine state, and an Agent that can use structured application capabilities.

All Future-owned implementation code was written by AI through iterative product direction, review, and manual testing by a human. Third-party projects retain their original authorship and licenses.

> [!IMPORTANT]
> FutureOS is not a complete, general-purpose operating system and is not intended for daily or production use. It is an active research prototype for exploring how AI-native operating systems may evolve—and how far a complex system can be built through AI-directed software development.

## Why FutureOS exists

Most desktop AI products add an assistant on top of an existing operating system. FutureOS explores a different model: AI is a visible system capability with explicit context, application tools, permissions, approvals, activity history, and actionable results.

The project is designed to test questions such as:

- What changes when applications expose structured capabilities to a system Agent?
- Can users understand what the Agent sees, which App it is using, and what it changed?
- How should risky operations, persistence, context, and cross-App work be represented?
- Which responsibilities belong to the browser shell, the Linux guest, and the Agent layer?
- What are the strengths and limits of building system software primarily through AI-generated code?

Using a real Linux guest means these ideas can be evaluated against processes, filesystems, networking, terminals, and persistent machine state instead of static UI mockups.

## Requirements

- Node.js `22.20.0` or newer in the Node 22 line
- pnpm `11.9.0`
- A modern desktop browser with WebAssembly and IndexedDB
- Approximately 300 MB of free space for the Alpine image, plus browser snapshot storage

Node 22 is the version used by CI. New, unsupported Node major versions may be incompatible with Corepack or the current dependency toolchain.

## Quick start

```bash
git clone https://github.com/czcgss/FutureOS-Web.git
cd FutureOS-Web
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

## Future AI

Open **Future AI → Settings → Model** and configure an OpenAI-compatible base URL, API key, and model. Model credentials are intended only for local development or trusted endpoints.

Future AI is designed as an operating-system capability, not an assistant layered on top of the desktop. It shares the system's application model, context, permissions, notifications, persistence, and live interface surfaces, allowing a request to become an observable system workflow instead of an opaque chat response.

- **System context:** invoke the Agent globally or from an App, then explicitly attach the active window, file, resource, date, text, or another open App.
- **Native App actions:** Apps expose validated tools for querying and changing real application data. Users control which Apps the Agent may operate.
- **Dynamic capabilities:** enabled Agents, App tools, imported Skills, and generated extensions are discovered at runtime rather than hard-coded into a single prompt.
- **Multi-Agent orchestration:** a Main Agent plans and delegates isolated work to capability-specific Agents. The Worktree shows ownership, progress, tool activity, and results for each task.
- **Visible execution:** the Agent workspace can host compact, live App views, so users can watch and continue the work in either the Agent or the full desktop App.
- **System safety:** risky terminal, file, and destructive operations pause for an in-system approval without blocking the rest of the desktop.
- **Shared system state:** conversations, usage, notifications, read state, workflows, Skills, and settings persist locally across refreshes.
- **Extensibility:** Agent Skills can create and validate Future Apps, widgets, themes, and other Skills against the system's runtime contracts.

Approval reduces accidental actions but is not a security boundary against malicious same-origin code or compromised dependencies. Never commit API keys or use production secrets in the browser client.

## Contributing

Contributions are welcome, but FutureOS uses a strict integration workflow:

1. Read [CONTRIBUTING.md](CONTRIBUTING.md).
2. Create a focused branch from the latest `develop`.
3. Run `pnpm check` and manually verify affected system behavior.
4. Open the pull request against `develop`, never directly against `main`.

Useful reports include the browser version, host OS, first-install or restored-snapshot state, minimal reproduction steps, and sanitized logs. UI pull requests should include screenshots without private data.

For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public issue. Third-party redistribution requirements are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

FutureOS is released under the [MIT License](LICENSE). Third-party components remain governed by their own licenses and notices.
