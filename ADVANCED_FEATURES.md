# Advanced Feature Decisions

## Encryption

The active legacy entry point loads `pb-sw.js`, `utils.js`, and `backend-sw.js`. It does not initialize an end-to-end encryption implementation. The Reborn project therefore does not migrate inactive encryption code or silently claim ciphertext support. If encryption becomes a supported requirement, it will use Web Crypto, a versioned envelope, and an explicit migration path.

## Mirrors

The active worker behavior supports mirrored notifications, validated app icons/images, safe HTTP(S) link opening, dismissal, and app mute/unmute through the Pushbullet ephemeral protocol. Clear-all remotely dismisses mirrored device notifications by default; this can be disabled in notification settings. Quick reply and Android action dispatch remain deferred because they require additional UI and action-dispatch contracts.

## Channels

Subscriptions and channel targets are read and persisted. Channel moderation controls are not part of the active legacy behavior and are intentionally deferred rather than exposing incomplete controls.

## Permissions

- Static host access is limited to `api.pushbullet.com`, Pushbullet's signed upload endpoints (`upload.pushbullet.com`, its upload subdomains, and `upload2.pushbullet.com`), and `www.pushbullet.com` for the upload credential cookie.
- `activeTab` is used only for an explicit active-tab attachment or command.
- `tabs` is used only to read the active tab URL and title for explicit push actions.
- `contextMenus` is optional and requested from the options page after a user gesture.
- Both builds read only the Pushbullet `api_key` cookie when starting or finishing a chunked file upload; they verify the cookie belongs to the configured account and do not persist it. Neither build requests broad page host access or native messaging.

## Privacy

Access tokens remain in extension storage and are only read by the service worker. UI pages communicate through typed runtime messages. Optional analytics are disabled by the corresponding setting and no analytics endpoint is included in the Reborn build.
