# Security policy

Aeris runs an emulated Linux system and can connect an AI model to operating-system tools. Treat it as experimental software, not as a hardened security boundary.

## Reporting a vulnerability

Use the repository's private GitHub Security Advisory reporting flow when available. Do not publish exploitable details, credentials, private conversations, or guest filesystem data in a public issue. Include affected versions, impact, reproduction steps, and a minimal proof of concept.

## Security boundaries

- API keys are stored locally for development and trusted endpoints; a browser application cannot guarantee protection against malicious same-origin code or a compromised dependency.
- High-risk Agent tools require an Aeris approval dialog, but contributors must still validate parameters and keep privileged operations narrowly scoped.
- The Linux guest, v86 runtime, browser origin, and host operating system have different trust boundaries. A guest sandbox is not a substitute for browser or host isolation.
- Clearing browser site data removes Aeris machine snapshots and local application state.

Please avoid using real secrets or irreplaceable data while evaluating Aeris.
