# Pushbullet Reborn and Classic (MV3)

Two component-based Manifest V3 frontends share the same typed service-worker backend: Reborn is the redesigned interface, while Classic reproduces the active legacy panel, options, chat, and welcome flows.

## Development

```bash
npm install
npm run dev
```

Build the redesigned unpacked extension into `dist-reborn/`:

```bash
npm run check
```

Load `dist-reborn/` from `chrome://extensions` with Developer mode enabled.

Build the Classic pipeline into `dist-classic/`:

```bash
npm run check:classic
```

Load `dist-classic/` separately when comparing the Classic frontend with the legacy extension.

## Current Boundary

- `src/background.ts` owns service-worker events and persisted extension state.
- `src/shared/messages.ts` is the validated, typed UI-to-worker message boundary.
- `src/popup/` owns the action popup.
- `src/options/` owns the settings page.
- `src/classic/` owns the component-based Classic pages; `classic-pages/` contains their HTML entries and `public/classic-assets/` contains the legacy visual assets.
- `public/manifest.json` is the base manifest; the Classic build patches its name and page routes after Vite emits the bundle.

## Permissions

- `storage`, `alarms`, `idle`, `notifications`, `offscreen`, `activeTab`, and `tabs` are required by the migrated worker and UI. `tabs` is used only to read the active tab URL/title for explicit push actions.
- `https://api.pushbullet.com/*` is used for authenticated API calls.
- `https://upload.pushbullet.com/*` is used only for signed file-upload destinations returned by Pushbullet.
- `contextMenus` is optional and is requested only when enabled from Settings.

Access tokens are validated and stored by the worker. UI code never calls Pushbullet directly. See `ADVANCED_FEATURES.md` for encryption, mirror, channel, and permission decisions.

The message protocol includes authentication, state refresh, settings, push, notification, chat, SMS, and active-chat commands. State is persisted by the service worker under the `extensionState` storage key; UI code does not maintain a second authoritative copy.

Legacy JavaScript is not imported. The active legacy source tree remains the behavioral and DOM reference while its CSS/assets are copied under `public/classic-assets/`; Classic behavior is implemented as React components over the shared worker boundary.

## Verification

```bash
npm run check
npm run unit
npm run smoke
# or run the complete verification gate
npm run verify
npm run verify:all
```

`npm run unit` checks typed message contracts, defaults, legacy state migration, URL validation, and upload serialization. `npm run smoke` and `npm run smoke:classic` exercise the corresponding production worker bundles with mocked Chrome APIs. `npm run artifact` and `npm run artifact:classic` check each packaged manifest and required runtime assets. `npm run verify:all` runs both pipelines.

## Migration and Release

The service worker migrates the legacy local keys into the `extensionState` schema on first startup and accepts legacy `apiKey` or `accessToken` storage. Chrome storage is isolated by extension ID, so a seamless migration requires shipping the replacement with the existing extension identity and signing key; an unrelated unpacked ID cannot read the installed legacy extension's storage.

Before release:

1. Run `npm run verify:all`.
2. Run `npm run package:all`.
3. Run `npm run validate:release` to validate both ZIPs and their checksums.
4. Load `dist-reborn/` and `dist-classic/` as separate unpacked extensions and manually exercise authentication, streams, push/link/file sends, notifications, options, chat, SMS/MMS, context menus, commands, sign-out, privacy approval, and worker restart.
5. Compare Classic against the active legacy extension, then publish using the replacement extension identity.

GitHub CI runs `npm run verify:all` on pull requests and packages preview artifacts. A coordinated release tag in the form `release/reborn-<reborn-version>-classic-<classic-version>` runs the release workflow and attaches both verified ZIPs and SHA-256 files to a GitHub Release. Chrome Web Store publishing remains a separate protected step.

The automated checks use mocked Pushbullet responses and do not replace a live-account verification pass.
