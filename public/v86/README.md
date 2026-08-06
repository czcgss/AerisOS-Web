# v86 runtime assets

This directory contains the small v86 runtime and firmware files needed by
Aeris:

- `libv86.js`
- `v86.wasm`
- `seabios.bin`
- `vgabios.bin`

The Alpine installation image is deliberately not committed. Run
`pnpm assets` from the repository root to download it from the official Alpine
mirror and verify its SHA-256 checksum before use.

See [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) for upstream
projects and licensing information.
