# Third-party software

Future depends on and/or redistributes the following third-party components. Their licenses apply to those components independently of the Future project license.

| Component | Use | License / source |
| --- | --- | --- |
| v86 | `libv86.js` and `v86.wasm` under `public/v86` | BSD-2-Clause; [copy/v86](https://github.com/copy/v86) |
| SeaBIOS | `seabios.bin` PC firmware under `public/v86` | GNU LGPL v3; [SeaBIOS source and releases](https://seabios.org/Download.html) |
| Bochs VGABIOS | `vgabios.bin` VGA firmware under `public/v86` | GNU LGPL v2.1; [bochs-emu/VGABIOS](https://github.com/bochs-emu/VGABIOS) |
| Alpine Linux 3.24.1 x86 | Linux installation media downloaded by `pnpm assets` | Package-specific open-source licenses; [Alpine downloads](https://www.alpinelinux.org/downloads/) |
| `@earendil-works/pi-agent-core` 0.83.0 | Stateful Agent loop and tool execution | MIT |
| `@earendil-works/pi-ai` 0.83.0 | Model provider abstraction | MIT |
| xterm.js 6 and FitAddon | VT/ANSI terminal emulation and terminal sizing | MIT; [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js) |
| Pyodide 314.0.5 | On-demand browser-hosted Python runtime for imported Agent Skills | MPL-2.0; [pyodide/pyodide](https://github.com/pyodide/pyodide) |
| Vite | Development server and production build | MIT |

The Alpine ISO is not stored in the source repository. The asset script downloads the official image and verifies its published SHA-256 checksum. The firmware binaries are separate works and are not covered by v86's BSD license. Review the corresponding source, notices, and license obligations before redistributing a packaged build.
