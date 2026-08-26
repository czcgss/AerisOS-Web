# Future Theme Package v1

Theme Studio accepts a complete JSON object with this structure:

```json
{
  "manifest": {
    "formatVersion": 1,
    "id": "lowercase-theme-id",
    "version": "1.0.0",
    "name": { "en": "Theme name", "zh": "主题名称" },
    "description": { "en": "English description", "zh": "中文说明" },
    "author": "Author",
    "baseMode": "light"
  },
  "tokens": {
    "colors": {
      "accent": "#5f87d7",
      "surface": "#e5edf2",
      "surfaceElevated": "#eef4f7",
      "text": "#31445a",
      "muted": "#77899b",
      "border": "#607a8a24",
      "positive": "#4c9a72",
      "warning": "#cf8a45",
      "danger": "#c65d6d"
    },
    "typography": { "uiFont": "Manrope, sans-serif", "monoFont": "Ubuntu Mono, monospace", "scale": 1 },
    "shape": { "small": 7, "medium": 12, "large": 18, "window": 18 },
    "icons": {
      "shape": "squircle",
      "scale": 1,
      "mode": "outline",
      "strokeWidth": 1.8,
      "linecap": "round",
      "linejoin": "round",
      "glyphs": {
        "settings": "M12 3A9 9 0 1 0 12 21A9 9 0 1 0 12 3M12 8A4 4 0 1 0 12 16A4 4 0 1 0 12 8",
        "folder": "M3 7H10L12 5H21V19H3Z"
      }
    },
    "material": { "blur": 26, "saturation": 1.25, "transparency": 0.92, "shadowStrength": 1 },
    "motion": { "scale": 1 }
  },
  "wallpaper": {
    "background": "radial-gradient(circle at 20% 20%, #d8c5ef, transparent 35%), linear-gradient(145deg, #dce9f1, #cbdbe7)",
    "preview": "#dce9f1"
  }
}
```

Constraints:

- Colors are six or eight digit hex values.
- `baseMode` is `light` or `dark` and provides compatibility behavior for older apps.
- Typography scale is 0.85–1.25.
- Shape values are pixel numbers within the validator limits.
- Icon container shape is `rounded`, `squircle`, or `circle`; icon scale is 0.8–1.15.
- Actual system glyphs may be redesigned through `icons.glyphs`. Each value is path data for a 24×24 SVG viewBox, begins with `M`, contains no markup, and is limited to 1,600 characters. Never provide raw `<svg>` or `<path>` elements.
- `icons.mode` is `outline` or `solid`. Outline sets may choose `strokeWidth` from 0.8–3, `linecap` from `round`, `square`, or `butt`, and `linejoin` from `round`, `bevel`, or `miter`.
- Supported host icon ids are: `logo`, `grid`, `list`, `info`, `warning`, `star`, `sparkles`, `skill`, `futureAi`, `message`, `history`, `arrowUp`, `stopSquare`, `wrench`, `files`, `globe`, `note`, `terminal`, `settings`, `vm`, `calc`, `search`, `wifi`, `battery`, `bell`, `close`, `minus`, `maximize`, `panelRight`, `compactView`, `focus`, `chevron`, `back`, `refresh`, `home`, `desktop`, `folder`, `document`, `copy`, `delete`, `image`, `play`, `pause`, `power`, `plus`, `upload`, `download`, `check`, `lock`, `user`, `moon`, `sun`, `cloud`, `rain`, `snow`, `storm`, `wind`, `volume`, `music`, `previous`, `next`, `shuffle`, `repeat`, `memory`, `accessibility`, `eye`, `keyboard`, `privacy`, `location`, `chart`, `calendar`, `contacts`, `reminder`, `textedit`, `browser`, `clock`, `timer`, `package`, `disk`, `preview`, `display`, and `paperclip`.
- Omitted glyph ids fall back to the Future built-in icon, so a focused icon set is valid. A complete redesign should cover every icon visible in the requested surfaces and keep a coherent visual grammar.
- Blur is 0–48, saturation 0.6–1.8, transparency 0.65–1, shadow strength 0–1.5, and motion scale 0–1.5.
- Wallpaper supports gradients and colors only. URLs, imports, scripts, and external resources are forbidden.
- Theme packages cannot contain arbitrary CSS or JavaScript.
- Preview is temporary and is shown as such in Settings while active. Installing a new theme ends preview, restores the previously selected theme, and adds the package to the Settings gallery without activating it. Installation/update/uninstall requires approval. Bundled themes cannot be changed or removed.
