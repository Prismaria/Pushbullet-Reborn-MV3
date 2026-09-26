# Pushbullet Reborn (MV3)

The new source tree for the Pushbullet Manifest V3 rewrite.

## Development

```bash
npm install
npm run dev
```

Build the unpacked extension into `dist/`:

```bash
npm run check
```

Load `dist/` from `chrome://extensions` with Developer mode enabled.

## Current Boundary

- `src/background.ts` owns service-worker events and persisted extension state.
- `src/shared/messages.ts` is the typed UI-to-worker message boundary.
- `src/popup/` owns the action popup.
- `src/options/` owns the settings page.
- `public/manifest.json` is copied unchanged into the build output.

The legacy extension is intentionally not copied into this project. Features will be migrated in small, testable slices after the scaffold is verified.
