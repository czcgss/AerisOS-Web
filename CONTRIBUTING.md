# Contributing to Aeris

Thanks for helping improve Aeris. The project is an experimental browser-hosted operating system, so changes should preserve the boundary between the browser shell, system services, and the Linux guest.

## Development setup

1. Install Node.js 20.19 or newer and enable Corepack.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm assets` to fetch and verify the Alpine boot image.
4. Run `pnpm dev` and open the printed local URL.

## Branch and pull request workflow

`main` is the stable release branch. `develop` is the integration branch and the only allowed pull request target for feature, fix, documentation, refactor, and maintenance work.

Always create a working branch from the latest `develop`:

```bash
git fetch origin
git switch develop
git pull --ff-only origin develop
git switch -c feature/short-description
```

Use a descriptive prefix such as `feature/`, `fix/`, `docs/`, `refactor/`, or `chore/`. Commit changes on that branch, push it, and open the pull request against `develop`:

```bash
git push -u origin feature/short-description
```

Before requesting review, update the branch with the latest `develop` and resolve conflicts on the working branch.

- Do not create feature branches from `main`.
- Do not open feature or maintenance pull requests against `main`.
- Do not push changes directly to `main` or `develop`.
- Moving tested changes from `develop` to `main` is a release operation performed by project maintainers, not part of a feature pull request.

## Before opening a pull request

- Confirm that the pull request base branch is `develop`.
- Confirm that the working branch was created from an up-to-date `develop`.
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
