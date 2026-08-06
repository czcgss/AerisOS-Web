# Aeris architecture

Aeris is a browser-hosted operating system built around an actual x86 Linux guest. The browser is the hardware and display host; it is not the source of process or filesystem demo data.

## Runtime layers

```text
Browser host
├── Aeris kernel
│   ├── service registry
│   ├── event bus
│   └── lifecycle management
├── Device layer
│   ├── v86 x86 CPU / hardware emulation
│   ├── VGA text and graphics device
│   ├── PS/2 keyboard bridge
│   ├── 16550A serial controller
│   └── VirtIO 9P device
├── Linux guest
│   ├── Alpine Linux 3.24 x86
│   ├── kernel processes
│   ├── procfs / sysfs
│   ├── shell runtime
│   └── /mnt/aeris shared filesystem
├── System services
│   ├── guest command broker
│   ├── process service
│   ├── filesystem service
│   ├── native dialog service
│   ├── settings service
│   ├── user data service
│   ├── AI agent and application tool service
│   └── internationalization service
└── Shell
    ├── desktop compositor
    ├── window manager
    ├── application registry
    └── system applications
```

## Source ownership

| Directory | Responsibility |
| --- | --- |
| `src/kernel` | Lifecycle, service registry and event delivery |
| `src/platform/v86` | Emulated hardware and host/guest transport |
| `src/services` | Stable OS APIs consumed by applications |
| `src/shell` | Desktop composition and window management |
| `src/apps` | Independently registered system applications |
| `src/locales` | Built-in language packs |
| `src/system` | Dependency composition and boot order |
| `public/v86` | Pinned emulator, BIOS and Linux boot media |

Applications must not reach into v86 directly. They consume system services from their application context. Platform-specific APIs remain isolated under `src/platform`.

`UserDataService` is the shared local-first persistence API for Calendar, Contacts, Reminders and Notes. It remains available while Linux starts and avoids routing native application edits through the interactive guest console. Linux filesystem applications use `GuestSystemService` directly.

The window manager is the source of truth for application running state. Dock indicators and application context menus query its live window records; closing or quitting an application runs its cleanup function and removes every associated window before the running state is cleared. It also owns Alt+Tab focus cycling, edge snapping, application launch locations and session restoration.

## Guest command transport

The Alpine compatibility runtime uses `tty2` as the interactive `aeris` console shown by Computer and Terminal. System requests are serialized by the platform bridge, wrapped in unique begin/end markers and paired with a real Linux exit status. The Terminal application pauses screen synchronization while a framed system request is active and preserves its previous rendered output until the user runs another command.

This compatibility transport was selected because the bundled Alpine kernel does not reliably retain a 16550A root session across v86 snapshot restoration. The platform boundary remains isolated in `src/platform/v86`, so a future virtio-console or guest daemon transport can replace it without changing applications. Files, processes, terminal commands and system metrics continue to come from the real Linux guest rather than browser-side fixtures.

Terminal presents the `tty2` user session as a conventional inline shell: the final Linux prompt is separated from the 80×25 VGA text grid and paired with the active input caret. Enter, Ctrl+C, Ctrl+L and command history are handled by the Terminal application and forwarded to the Linux shell.

## Filesystem

Files exposes the `aeris` user's Home, Desktop, Documents, Downloads and Pictures locations, plus a separately labelled Shared location. Linux mount paths remain an implementation detail and are translated into user-facing breadcrumbs. Desktop icons are backed by `/home/aeris/Desktop`, so filesystem changes are reflected by both the desktop shell and Files.

All application prompts are rendered by the native Aeris dialog service. Applications do not call browser `prompt`, `alert` or `confirm` APIs. Aeris initializes a v86 9P device and attempts to mount it at `/mnt/aeris`; the user's home directories live inside Alpine and are retained by machine snapshots.

## Persistence model

Machine persistence and desktop persistence are deliberately separate:

- `MachineStateStore` saves gzip-compressed v86 snapshots to IndexedDB, keyed by guest-image version and configured memory.
- The platform requests checkpoints after guest filesystem or terminal activity, when the page becomes hidden, after boot, and every 60 seconds.
- `WindowManager` records open applications, positions, sizes, minimized state and maximized state in local storage.
- Refresh restores the latest completed machine checkpoint and reconstructs the window session. A normal Quit still destroys that application instance.

This is snapshot-based persistence of the complete running computer, not yet a separately installed writable virtual disk. Browser site-data removal also removes the persisted operating-system state.

## Installation gate

The desktop shell may be composed while the guest starts, but it remains inert and fully covered by the system installation screen. On a first run, Aeris does not unlock the desktop until Alpine has booted, the local account and home directories exist, the control services are running, and the first recoverable machine snapshot has been committed to IndexedDB. Later page loads use the same gate while restoring the saved snapshot. Boot-stage and v86 download-progress events drive the visible status and progress bar; setup errors leave the desktop locked instead of exposing a partially initialized system.

After the installation gate, incomplete systems enter `SetupAssistant` instead of the desktop. The assistant configures language, region, time zone, keyboard layout, accessibility, network disclosure, the local account, privacy defaults and appearance. Completion writes `/home/aeris/.config/aeris/profile.json`, optionally sets the real Linux account password, persists OS preferences and commits another machine checkpoint. Only then is the desktop made interactive. An interrupted assistant keeps its non-sensitive draft locally and never stores the password.

## Application and Agent baseline

The registry provides eighteen modules: Aeris AI, Files, Calendar, Contacts, Reminders, Notes, Text Editor, Preview, Photos, Trash, Weather, Calculator, Clock, Disk Utility, Terminal, Computer, System Monitor and Settings. Files routes documents to Text Editor or Preview; Disk Utility reads the guest's real filesystems and mounts. Browser, package installation and cloud-dependent categories are not represented by inert mock applications: they require embedding, privilege, account, protocol or permission capabilities before registration.

`AiAgentService` owns provider configuration, Pi Agent sessions, explicit user/assistant turns, browser recovery, and guest persistence. `SystemToolService` exposes application capabilities as validated Agent tools. Each application can be removed from the Agent's active tool set, and high-risk tool definitions pass through an Aeris approval dialog. Raw Pi messages remain the model transcript; the persisted turn model groups intermediate assistant text, tool calls, tool results, and the final summary into one visible answer for each user request.

## Application contract

An application exports a descriptor:

```js
export default {
  id: 'example',
  title: 'translationKey',
  icon: 'iconName',
  singleInstance: true,
  mount(root, systemContext) {
    // Return a cleanup function for timers and subscriptions.
    return () => {};
  }
};
```

The registry owns discovery; the window manager owns instances and lifecycle. Applications own only the DOM below their assigned root.
