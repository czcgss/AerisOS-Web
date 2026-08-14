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
