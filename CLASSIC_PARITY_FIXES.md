# Classic Panel Screenshot Parity Fixes

These fixes compare the component-based Classic panel with the active `366_0` panel and address the differences visible in the supplied screenshots.

## Fixed

- **History opens at the latest push and keeps loading older pushes.** The initial scroll could run before remote pushes, image sizes, or a hidden pop-out's final dimensions had settled. The panel now repeats the bottom scroll after layout, observes content/size changes, and preserves manual reading position. The first page includes up to 100 pushes; scrolling to the oldest visible items automatically requests the next API cursor page, without a “See full history” click.
- **“See full history” stays in the pop-out.** The link is present as a website fallback and navigates the current panel window to the selected Pushbullet history route instead of opening another tab.
- **Device rows show recent activity.** The “All devices” row and individual stream rows now display their latest push title, body, URL, or file name. Streams are ordered by newest activity, with streams that have no pushes ordered by name.
- **Long URLs fit the history bubble.** Bubbles are constrained to the available panel width and links can wrap instead of being clipped at the right edge.
- **Message-body URLs are clickable.** HTTP and HTTPS URLs embedded in push body text render as safe external links.
- **History restores previews and context.** Image pushes and image-file attachments render as thumbnails; messages are separated by legacy-style time dividers, the newest push gets a relative timestamp, and the end of each sender group shows its stream avatar.
- **Non-web tabs do not create composer errors.** Automatic link attachment silently skips Chrome pages and other non-HTTP(S) tabs rather than placing “The active tab is not a web page” in the composer.
- **Composer controls match the panel.** The idle send control opens the file picker with a paperclip icon instead of showing an “Attach file” text label.
- **Link preview space is opaque and reserved.** Opening the preview raises the history pane above the composer and gives the preview its proper light/dark background, preventing history content from showing through it.
- **Legacy image metadata survives state migration.** Old snake_case image and file fields are normalized into the current push model.
- **Profile avatars survive popup reopen.** Persisted camelCase user image URLs are now preserved when the worker normalizes stored account state.
- **Options page restores legacy formatting and account status.** The Options-only header/avatar/ribbon sizing is loaded, and an authenticated account shows the configured-token placeholder and authenticated email.
- **Classic attachments send immediately.** Selecting or dropping a file starts the upload and sends it at once, matching the original panel; no second Send click is required. Push, SMS/MMS, and chat-pop-out paths use the same behavior.
- **Uploads appear in chat as progress bubbles.** Push and MMS uploads show the selected file name and a progress bar in the message history while upload work is in progress.
- **Upload chunks survive Chrome messaging serialization.** Chunks are sent as bounded base64 strings with byte lengths instead of `ArrayBuffer` values that Chrome may serialize as plain objects, which caused “Invalid upload message.”
- **Signed uploads accept Pushbullet's `upload2` host.** The URL allowlist now includes `upload2.pushbullet.com`, verified against the legacy implementation's Pushbullet subdomain permissions.

## Verification

- `npm run unit` covers latest-push selection, stream preview ordering, exclusion of client pushes from “All devices,” legacy image metadata migration, and history-message validation.
- `npm run verify:all` checks both build pipelines, worker behavior (including upload chunks, cursor pagination, and exhaustion), and build artifacts.
- Manual Chrome comparison is still needed for image loading from a live account and final visual parity against `366_0`.
