# Advanced Feature Decisions

## Encryption

The active legacy entry point loads `pb-sw.js`, `utils.js`, and `backend-sw.js`. It does not initialize an end-to-end encryption implementation. The Reborn project therefore does not migrate inactive encryption code or silently claim ciphertext support. If encryption becomes a supported requirement, it will use Web Crypto, a versioned envelope, and an explicit migration path.

## Mirrors

The active worker behavior supports mirrored notifications, safe HTTP(S) link opening, dismissal, and persisted action IDs. Quick reply, Android action dispatch, and app muting are not ported because they only exist in inactive legacy modules or require a separate protocol contract.

## Channels

Subscriptions and channel targets are read and persisted. Channel moderation controls are not part of the active legacy behavior and are intentionally deferred rather than exposing incomplete controls.

## Permissions

- Static host access is limited to `api.pushbullet.com` and `upload.pushbullet.com`.
- `activeTab` is used only for an explicit active-tab attachment or command.
- `tabs` is used only to read the active tab URL and title for explicit push actions.
- `contextMenus` is optional and requested from the options page after a user gesture.
- No broad page host access, cookies, tabs, or native messaging permission is requested.

## Privacy

Access tokens remain in extension storage and are only read by the service worker. UI pages communicate through typed runtime messages. Optional analytics are disabled by the corresponding setting and no analytics endpoint is included in the Reborn build.
