# Pushbullet Reborn MV3 Migration Plan

This is the execution plan for the React + Vite + TypeScript Pushbullet Reborn and Classic pipelines. It is a living checklist: a phase is only marked complete after its acceptance checks pass.

## Migration Rules

- Migrate active behavior from `Pushbullet/chlffgpmiacpedhhbkiomidkjlcfhogd/366_0`; do not copy inactive `old_js` or duplicated `*-sw.js` implementations wholesale.
- Keep the service worker framework-agnostic. React owns UI only.
- Keep one authoritative state model in `chrome.storage.local`.
- Use discriminated-union runtime messages; no global `pb` facade in the new source tree.
- Keep permissions and host permissions narrow until a feature requires expansion.
- Do not forward arbitrary URLs or silently move Pushbullet tokens through UI code.
- Prefer Web APIs and typed modules over legacy DOM mutation, `localStorage`, JSON-stringified maps, and function-bearing messages.
- Every phase must leave the project buildable with `npm run check`.

## Phase 0: Foundation

Status: complete

- [x] Create the Vite + React + TypeScript project.
- [x] Create popup, options, and module service-worker entries.
- [x] Add the minimal MV3 manifest and `storage` permission.
- [x] Add relative asset output for `chrome-extension://` pages.
- [x] Add the typed runtime message boundary.
- [x] Add versioned `extensionState` persistence.
- [x] Verify TypeScript, Vite build, generated manifest references, and service-worker protocol smoke tests.

Acceptance: the generated `dist-reborn/` directory loads as an unpacked MV3 extension and the popup can read state from the service worker.

## Phase 1: State, Authentication, and API Boundary

Status: complete

- [x] Define typed domain models for users, devices, pushes, chats, subscriptions, notifications, SMS, and uploads.
- [x] Add schema migration from legacy `apiKey`, `accessToken`, user, device, settings, and cached map keys.
- [x] Add worker-only token validation using `/v2/users/me`.
- [x] Add typed `set_token`, `sign_out`, `get_state`, and `refresh_state` messages.
- [x] Persist connection status and authenticated user state.
- [x] Add API request helpers with a Pushbullet path allowlist.
- [x] Remove UI-side token fallback and arbitrary API forwarding from the new architecture.
- [x] Migrate popup and options authentication to React.

Acceptance: fresh install, legacy-state migration, valid token, invalid token, sign-out, worker restart, and API failure all produce deterministic UI state without exposing tokens to React logs. Verified by `npm run check` and mocked worker auth/state smoke tests.

## Phase 2: Remote State and Connection

Status: complete

- [x] Port device registration and remote state refresh.
- [x] Port WebSocket connection, reconnect, heartbeat, and refresh alarms.
- [x] Persist devices, chats, subscriptions, channels, grants, pushes, and texts.
- [x] Broadcast typed state changes to open extension pages.
- [x] Keep optional endpoint failures non-fatal and observable.

Acceptance: the worker can restart, reload cached state, refresh remote state, reconnect the WebSocket, and report connected/offline status without a popup being open. Verified by `npm run check` and mocked remote-sync/alarm smoke tests.

## Phase 3: React Popup and Pushes

Status: complete

- [x] Create the authenticated popup shell and connection banner.
- [x] Migrate Friends, Me, and Following stream tabs.
- [x] Migrate stream rows, selected state, push history, and empty states.
- [x] Migrate note/link sending and active-tab link attachment.
- [x] Migrate account view, sign-out, snooze, and pop-out behavior.
- [x] Preserve responsive popup sizing and dark mode.

Acceptance: authenticated users can browse streams, select targets, send notes and links, open a pop-out, sign out, and recover from offline state. Verified by `npm run check` and the production-bundle worker smoke test.

## Phase 4: Notifications and Audio

Status: complete

- [x] Port notification records, badge counts, dismissal, and action IDs.
- [x] Port mirror notifications and automatic link opening with safe URL validation.
- [x] Add the offscreen audio entry and alert asset.
- [x] Render notification state in React when the popup is open.

Acceptance: notifications and actions work while the popup is closed, state survives worker restart, and no notification action depends on a serialized function. Verified by `npm run check` and the production-bundle worker smoke test.

## Phase 5: File Uploads

Status: complete

- [x] Add typed upload lifecycle messages.
- [x] Add size and MIME validation.
- [x] Replace whole-file base64 runtime messages with bounded/chunked transfer or a controlled upload port.
- [x] Add progress, cancellation, failure, and retry state.
- [x] Migrate file picker, paste, and drag/drop for push and SMS attachments.
- [x] Validate signed upload URLs before use.

Acceptance: small and large push/SMS attachments can be selected, dropped, uploaded, cancelled, retried, and rendered with deterministic progress and failure states. Verified by `npm run check` and the production-bundle worker smoke test, including push and SMS upload ports.

## Phase 6: Chat Window, SMS, and Threads

Status: complete

- [x] Add a dedicated Vite chat entry.
- [x] Migrate push chat history and target picker.
- [x] Migrate SMS device picker, thread list, phonebook, replies, and quota banners.
- [x] Migrate SMS image/MMS handling with explicit capability checks.
- [x] Replace legacy `localStorage` selections with typed extension storage.
- [x] Add worker-backed active-chat lifecycle handling.

Acceptance: push chats, SMS threads, replies, attachments, and chat-window cleanup work across popup close/open and worker restart. Verified by `npm run check` and the production-bundle worker smoke test.

## Phase 7: Options, Permissions, Commands, and Context Menus

Status: complete

- [x] Migrate all supported settings into React.
- [x] Add optional permission requests only from explicit user gestures.
- [x] Port commands for dismissal, instant push, and pop-out.
- [x] Port context menus using serializable target IDs and safe URL handling.
- [x] Remove invalid MV2 permission and browser-action assumptions.
- [x] Keep host access limited to the API and explicitly required Pushbullet pages.

Acceptance: settings persist, permission states are accurate, commands work, context menus target the selected device/person, and no broad host permission is added without a documented reason. Verified by `npm run check` and the production-bundle worker smoke test.

## Phase 8: Assets, Localization, and Advanced Features

Status: complete

- [x] Migrate required icons, fonts, alert audio, and visual assets.
- [x] Migrate supported locales through a typed translation layer.
- [x] Review whether end-to-end encryption is required; if retained, use Web Crypto with an explicit versioned format.
- [x] Review channel controls, mirrored notification actions, mute/unmute, Android actions, and quick reply against active behavior; implement the supported subset and document deferred protocols.
- [x] Add privacy and permission documentation.

Acceptance: all shipped UI has real assets, supported locales render, advanced features have tests and explicit security decisions, and no dead legacy implementation remains in the build. Verified by `npm run check`, `npm run smoke`, and `ADVANCED_FEATURES.md` decisions.

## Phase 9: Verification and Cutover

Status: in progress

- [x] Add unit tests for state migration, message validation, URL validation, and upload serialization.
- [x] Add service-worker integration tests with mocked Chrome APIs.
- [x] Verify the packaged manifest, entry points, localized messages, and icon dimensions.
- [ ] Add unpacked-extension smoke tests for popup, options, chat, authentication, notifications, uploads, and sign-out. The current artifact smoke test verifies packaged entry points and assets; actual UI flows remain manual.
- [x] Test worker reload/restart persistence and no-popup operation through the production bundle smoke test.
- [ ] Compare active behavior against the legacy extension.
- [x] Update README with development, permissions, migration, and release instructions.
- [x] Review legacy compatibility code; retain only the persisted-state migration required for replacement installs.

Acceptance: `npm run check` passes, the extension loads from `dist-reborn/`, all required manual flows pass, and the Reborn project can replace the legacy extension for the supported feature set.

## Phase 10: Classic Frontend Parity

Status: in progress

- [x] Add independent Classic Vite entries for panel, options, chat, welcome, and offscreen pages.
- [x] Keep Classic component-based while reusing the shared worker/message/upload backend.
- [x] Copy the active legacy CSS and visual assets into the Classic artifact.
- [x] Preserve legacy DOM IDs/classes for panel, notifications, account, authentication, chat, SMS, and options surfaces.
- [x] Add Classic pop-out routing, tab/target persistence, welcome/privacy approval, friend/channel action rows, and SMS new-thread/phonebook flows.
- [x] Restore latest-push stream summaries and activity ordering, wrapped links, image previews, time dividers, sender avatars, and bottom-anchored history scrolling.
- [x] Load Pushbullet history cursor pages as the user scrolls up, and keep the website fallback link in the current panel window.
- [x] Skip automatic link attachment on non-web tabs without surfacing a composer error.
- [ ] Match all legacy SMS pending/retry/MMS states and periodic refresh behavior.
- [ ] Match mirrored notification images, mute/reply/Android actions, and source-device behavior.
- [ ] Complete an unpacked visual and interaction comparison against `366_0`.

Screenshot-driven Classic panel fixes and their validation scope are recorded in `CLASSIC_PARITY_FIXES.md`.

Acceptance: `dist-classic/` loads as an independent MV3 extension, shares only the approved backend contracts, and matches the active legacy frontend behavior and visual structure across all shipped pages.

## Current Next Action

Complete Phase 9 browser checks and Phase 10 parity work by comparing both generated artifacts against the active legacy behavior; live account and browser checks remain the final cutover gates.
