# Pushbullet Reborn and Classic — Chrome Extensions for Manifest V3

Send links, notes, and files between Chrome and your Pushbullet devices, browse push history, and receive desktop notifications. Pushbullet Reborn and Classic bring two interface choices to a shared Manifest V3 extension backend.

**[Download the latest release](https://github.com/Prismaria/Pushbullet-Reborn-MV3/releases/latest)** · **[Install in Chrome](#install-in-chrome)** · **[Frequently asked questions](#frequently-asked-questions)**

## Features

- **Link, note, and file sharing:** push to your devices, contacts, and subscribed channels, with upload progress and support for larger files within your account's limits. Incoming image pushes open in a background tab by default; you can turn this off in settings.
- **Push history:** browse previous pushes, follow links, and open attachments. Classic includes device streams, previews, and automatic loading of older history.
- **Desktop and mirrored notifications:** receive push alerts and phone notification mirrors with app icons, images, and mute/unmute controls. Missed pushes are checked after wake or reconnect.
- **SMS and MMS:** view conversations and send messages or attachments through a compatible connected phone.
- **Browser shortcuts:** push the current tab, use optional right-click sharing menus, or open conversations in a separate window.
- **Interface preferences:** choose a redesigned or Classic-style interface, with dark mode and notification settings.

## Reborn vs. Classic

| | Reborn | Classic |
| --- | --- | --- |
| Interface | Redesigned popup, settings, and chat views | Recreates the legacy Pushbullet panel, options, and chat layout |
| Best fit | You prefer the redesigned interface | You prefer the familiar Classic layout and device streams |
| Release download | `pushbullet-reborn-<version>.zip` | `pushbullet-classic-<version>-<version_name>.zip` |

Both variants share the same account connection, push delivery, notifications, and file-transfer backend. They are packaged as separate extensions; choose one to get started.

This project is in beta. See the [release notes](https://github.com/Prismaria/Pushbullet-Reborn-MV3/releases) for recent changes and [Classic parity notes](CLASSIC_PARITY_FIXES.md) for implementation details and remaining comparison work.

## Install in Chrome

### From a GitHub Release

1. Open the [latest GitHub Release](https://github.com/Prismaria/Pushbullet-Reborn-MV3/releases/latest) and download either `pushbullet-reborn-<version>.zip` or `pushbullet-classic-<version>-<version_name>.zip` from **Assets**.
2. Extract the ZIP into a local folder. Chrome cannot load the ZIP file directly.
3. Open `chrome://extensions` in Chrome.
4. Enable **Developer mode** using the switch in the upper-right corner.
5. Click **Load unpacked**.
6. Select the extracted folder that directly contains `manifest.json`. Do not select the ZIP file, the repository root, or a parent folder.
7. Open the extension from Chrome's Extensions menu and connect using an access token from your [Pushbullet account settings](https://www.pushbullet.com/#settings/account).

The Reborn and Classic ZIPs are separate extensions. Load only the variant you want to use, or load both when comparing their behavior.

### From a Local Build

1. Install dependencies with `npm install`.
2. Build Reborn with `npm run check`, or build Classic with `npm run check:classic`.
3. Open `chrome://extensions` and enable **Developer mode**.
4. Click **Load unpacked** and select `dist-reborn/` or `dist-classic/`.
5. After rebuilding, return to `chrome://extensions` and click **Reload** on the corresponding extension.

## Frequently asked questions

### Does this Pushbullet extension use Manifest V3?

Yes. Both Reborn and Classic use Chrome's Manifest V3 extension format. Classic recreates the legacy interface on the MV3 backend; it does not load the old Manifest V2 extension.

### Which should I install: Reborn or Classic?

Choose Classic for the familiar Pushbullet layout and device-based history, or Reborn for the redesigned interface. Both connect to the same Pushbullet service. You can install them separately to compare, but running both can produce duplicate alerts.

### How do I install the downloaded ZIP in Chrome?

Extract the extension ZIP, enable Developer mode at `chrome://extensions`, and select **Load unpacked**. Choose the extracted folder containing `manifest.json`. Use the extension ZIP under the release's **Assets**, rather than GitHub's automatically generated source-code archive. See [Install in Chrome](#install-in-chrome) for the full steps.

### Do I need a Pushbullet account or a Pro subscription?

You need a Pushbullet account and an access token from [account settings](https://www.pushbullet.com/#settings/account). Your account's plan and service limits still apply; this extension does not unlock Pro features. Large-file uploads also require signing into the same account on the Pushbullet website so the extension can use the account's upload credential.

### Will it replace my existing Pushbullet extension and import its settings?

Loading a GitHub build as an unpacked extension creates a separate installation. It cannot automatically read another extension's local settings or credentials. After connecting your account, it fetches your Pushbullet history from the service. Importing legacy local settings requires a compatible extension identity; see [Migration and Release](#migration-and-release).

### Are all legacy Pushbullet features supported?

The project supports push sharing, history, notifications, and SMS/MMS through compatible devices, but full legacy parity is still in progress. Mirrored-notification quick reply, Android action dispatch, channel moderation, and end-to-end encrypted payload support are not currently implemented. See [Advanced Feature Decisions](ADVANCED_FEATURES.md) for the current scope.

## Development

```bash
npm install
npm run dev
```

Build the redesigned unpacked extension into `dist-reborn/`:

```bash
npm run check
```

Build the Classic pipeline into `dist-classic/`:

```bash
npm run check:classic
```

For local loading instructions, see [Install in Chrome](#install-in-chrome). Load `dist-classic/` separately when comparing the Classic frontend with the legacy extension.

## Current Boundary

- `src/background.ts` owns service-worker events and persisted extension state.
- `src/shared/messages.ts` is the validated, typed UI-to-worker message boundary.
- `src/popup/` owns the action popup.
- `src/options/` owns the settings page.
- `src/classic/` owns the component-based Classic pages; `classic-pages/` contains their HTML entries and `public/classic-assets/` contains the legacy visual assets.
- `public/manifest.json` is the base manifest; the Classic build patches its name and page routes after Vite emits the bundle.
- `CLASSIC_PARITY_FIXES.md` records screenshot-driven Classic panel parity fixes and remaining manual comparison work.

## Permissions

- `storage`, `alarms`, `idle`, `notifications`, `offscreen`, `activeTab`, and `tabs` are required by the migrated worker and UI. `tabs` is used only to read the active tab URL/title for explicit push actions.
- `https://api.pushbullet.com/*` is used for authenticated API calls.
- Pushbullet signed file-upload URLs may use `upload.pushbullet.com`, its upload subdomains, or `upload2.pushbullet.com`.
- Both builds request `cookies` and `https://www.pushbullet.com/*` to read the signed-in account's `api_key` cookie for legacy chunked large-file uploads. The configured access token remains the normal API credential; the cookie is used only for the legacy large-upload start/finish requests and is not persisted.
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
