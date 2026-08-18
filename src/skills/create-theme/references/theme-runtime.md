# Aeris Theme Package v1

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
    "icons": { "shape": "squircle", "scale": 1 },
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
- Icon shape is `rounded`, `squircle`, or `circle`; icon scale is 0.8–1.15.
- Blur is 0–48, saturation 0.6–1.8, transparency 0.65–1, shadow strength 0–1.5, and motion scale 0–1.5.
- Wallpaper supports gradients and colors only. URLs, imports, scripts, and external resources are forbidden.
- Theme packages cannot contain arbitrary CSS or JavaScript.
- Preview is temporary. Installation/update/uninstall requires approval. Bundled themes cannot be changed or removed.
