---
name: create-widget
description: Create, inspect, modify, validate, install, update, and uninstall Future desktop widgets when the user asks for a new desktop component or wants to manage an existing generated widget.
---

# Create a Future desktop widget

Use this skill only for packages that run through Future Widget Runtime. Never edit `DesktopWidgets.js` to add a generated widget. Read and follow the bundled `references/widget-runtime.md` contract before producing source.

## Required workflow

1. Turn the request into one glanceable widget with a lowercase hyphenated id.
2. Choose only the sizes the content can genuinely support and select one default size.
3. Request the minimum capabilities required for real data and actions.
4. Implement English and Chinese metadata and visible strings.
5. Implement loading, empty, error, stale, hover, active, focus, and reduced-motion behavior where applicable.
6. Validate the complete package with Widget Studio and correct every error.
7. Install only the exact validated draft after system approval.
8. Report the widget id and tell the user it is available in the desktop widget gallery.

For modification, inspect the runtime package instead of using Terminal or Files, preserve its id and files, increment its semantic version, validate the complete result, and update only after approval. Uninstall requires explicit system approval.

Do not claim creation, update, or installation succeeded unless the corresponding Widget Studio operation completed.
