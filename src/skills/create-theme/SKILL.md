---
name: create-theme
description: Create, inspect, validate, preview, install, update, apply, and uninstall complete Aeris system themes when the user wants to customize the operating system appearance.
---

# Create an Aeris system theme

Use Theme Studio for system-wide themes. A theme is a declarative package, not arbitrary CSS. It must provide a coherent visual system for the shell, built-in apps, extension apps, widgets, notifications, Agent surfaces, and setup/recovery screens.

## Required workflow

1. Clarify the intended mood, light or dark foundation, primary color, contrast needs, corner character, material density, typography scale, motion level, wallpaper direction, and whether the user wants a redesigned icon set when the request is ambiguous.
2. Inspect an installed theme when modifying it. Preserve its id and increment its semantic version.
3. Produce the complete package described in the bundled theme contract, including English and Chinese metadata. When redesigning icons, provide safe 24×24 SVG path data for the relevant system icon ids instead of changing only the icon container shape.
4. Keep text/background contrast readable and use restrained semantic colors for success, warning, and danger.
5. Validate the complete package with Theme Studio and correct every validation error.
6. Preview the validated draft so the user can see the system-wide result before installation.
7. Install or update only after explicit system approval. Installing a new theme ends its preview, restores the previously selected theme, and adds the new package to Settings → Appearance. Do not apply it unless the user explicitly asks to use it.
8. Report the theme id, version, base mode, custom icon count, and whether it is installed, previewed, or active.

Never claim a theme was validated, previewed, installed, updated, applied, or removed unless the corresponding Theme Studio operation completed.
