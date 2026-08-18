# Neumorphism

## 1. Visual Theme & Atmosphere

Neumorphism is a UI style reference for general interfaces, combining Soft UI, embossed, debossed, convex, concave, light source, subtle depth, rounded (12-16px), monochromatic. The visual direction is shaped by Soft box-shadow (multiple: -5px -5px 15px, 5px 5px 15px), smooth press (150ms), inner subtle shadow.

Use it for Health/wellness apps (健康), meditation platforms (平台), fitness trackers, minimal interaction UIs. Avoid it for Complex apps (應用程式), critical accessibility (無障礙性), data-heavy dashboards (儀表板), high-contrast required.

**Key Characteristics:**
- Primary palette: Light pastels: Soft Blue #C8E0F4, Soft Pink #F5E0E8, Soft Grey #E8E8E8
- Secondary palette: Tints/shades (±30%), gradient subtlety, color harmony
- Effects: Soft box-shadow (multiple: -5px -5px 15px, 5px 5px 15px), smooth press (150ms), inner subtle shadow
- Accessibility: ⚠ Low contrast; performance: ⚡ Good; dark mode: ◐ Partial.
- Best for: Health/wellness apps (健康), meditation platforms (平台), fitness trackers, minimal interaction UIs
- Avoid for: Complex apps (應用程式), critical accessibility (無障礙性), data-heavy dashboards (儀表板), high-contrast required

## 2. Implementation Notes

- Framework fit: Tailwind 8/10, CSS-in-JS 9/10
- Era reference: 2020s Modern
- Local preview: [Open HTML preview](../../refstyles/02-neumorphism.html)
- Library index: [Open UI/UX Pro Max home](../../index.html)

## 3. System Theme Contract

Neumorphism defines the bundled Aeris visual direction, but applications must not hard-code it as the only possible appearance. Every shell surface, built-in application, extension application, widget, notification, Agent surface, setup screen, and recovery screen consumes semantic system theme tokens.

Theme packages may customize the color roles, typography families and scale, corner system, application-icon treatment, glass material, depth, motion scale, and wallpaper. Components must use variables such as `--surface`, `--surface-2`, `--text`, `--muted`, `--accent`, `--line`, `--positive`, `--warning`, `--danger`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--window-radius`, `--icon-radius`, `--glass-blur`, `--font-ui`, and `--font-mono` instead of introducing an unrelated application-wide palette.

The active theme can change without an application restart. Extension applications and widgets must subscribe to their Aeris environment and re-render any derived appearance when the theme id, version, base mode, tokens, or variables change. Reduced-motion preferences always override theme motion.
