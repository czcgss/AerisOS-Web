# Contributing to Aeris

Thanks for helping improve Aeris. The project is an experimental browser-hosted operating system, so changes should preserve the boundary between the browser shell, system services, and the Linux guest.

## Development setup

1. Install Node.js 20.19 or newer and enable Corepack.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm assets` to fetch and verify the Alpine boot image.
4. Run `pnpm dev` and open the printed local URL.

## Before opening a pull request

- Run `pnpm check`.
- Test first boot and snapshot restoration when changing v86, setup, persistence, or guest services.
- Test both English and Simplified Chinese when changing visible copy or layout.
- Use Aeris dialogs and clipboard services; do not call browser `alert`, `confirm`, or `prompt` from applications.
- Keep applications behind service interfaces instead of importing the v86 platform directly.
- Do not commit API keys, user data, machine snapshots, downloaded ISO images, dependencies, or build output.
- Update the README or architecture document when behavior or module ownership changes.

## Change scope

Prefer focused pull requests. Explain the user-visible behavior, architectural impact, verification performed, and any persistence migration. Screenshots are useful for UI changes, but do not include private conversations or local machine data.

## Reporting bugs

Include browser and operating-system versions, whether the problem occurred on first boot or snapshot restore, reproduction steps, and relevant console output. Remove API keys, conversation content, filesystem contents, and other private data before attaching logs.
