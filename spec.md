# WhatsApp → Buffer Publisher

## 1. Product summary

Build a small, local-first desktop application that turns a message sent to a private WhatsApp destination into a Facebook Page post through Buffer.

The primary flow is:

```text
User writes a message and attaches images in WhatsApp
        ↓
WhatsApp self-chat (default) or explicitly configured empty group
        ↓
Local WhatsApp listener
        ↓
Message/media normalization and post preview
        ↓
Buffer
        ↓
Facebook Page post
```

The application should begin with the user's operating system, run quietly as a background service, and expose a system-tray interface for setup, status, logs, drafts, and controls.

The existing Node.js prototype already handles text messages from a configured WhatsApp self-chat and publishes through Buffer's GraphQL API. This specification describes the product direction and the changes required to make the prototype a reliable desktop application with image support.

## 2. Goals

### Must have

- Allow a user to send text and one or more images from WhatsApp.
- Use the user's WhatsApp self-chat ("Message Yourself") as the default input surface.
- Support an explicitly configured empty/private WhatsApp group as an alternative input surface.
- Create a post for a selected Facebook Page connected to the user's Buffer account.
- Preserve captions and the intended order of images.
- Provide clear success, failure, and retry feedback in WhatsApp.
- Run as a background process without requiring a terminal window.
- Start automatically with the user's operating system.
- Provide a system-tray application for setup and basic controls.
- Keep credentials, WhatsApp session data, and downloaded media on the user's machine unless they are sent to Buffer as part of publishing.
- Make publishing behavior observable through a local history and application logs.

### Should have

- Preview and approval mode before publishing.
- Immediate publishing by default, with scheduling retained as an option.
- Drafts that can be reviewed and published from the tray UI.
- Multiple configured destinations/pages, with one active destination at a time.
- Reconnection after temporary WhatsApp, network, or Buffer outages.
- Idempotent retries so a failed retry does not create duplicate posts.
- A guided first-run setup flow.
- A visible connection/status indicator in the tray.

### Nice to have

- Hashtag or command-based controls from WhatsApp.
- A local webview or settings window for richer post editing.
- Post templates and default hashtags.
- Support for video and documents that can be converted into supported social media content.
- Additional Buffer channels after the Facebook Page workflow is stable.

## 3. Non-goals for the first desktop release

- Monitoring arbitrary WhatsApp chats or all incoming messages.
- Sending messages to contacts or groups.
- Becoming a general-purpose social media scheduler.
- Storing a cloud copy of the user's WhatsApp messages or media.
- Replacing Buffer's analytics, inbox, or content calendar.
- Supporting multiple WhatsApp accounts inside one desktop installation.
- Automatically publishing messages from a group unless the group has been explicitly selected and verified.

## 4. User experience

### 4.1 First run

1. The user installs and launches the application.
2. The setup window explains that the app reads only one configured WhatsApp destination and publishes to one Buffer-connected Facebook Page.
3. The user scans a WhatsApp QR code using **Linked Devices**.
4. The app detects the linked WhatsApp identity and asks the user to choose an input destination:
   - **Message Yourself** (recommended), or
   - **Private/empty group** selected from the user's available groups.
5. The user enters or confirms the Buffer API key.
6. The app loads Buffer organizations and Facebook channels.
7. If there is exactly one organization and one Facebook channel, the app selects them automatically. Otherwise, the user chooses the organization and Page.
8. The app sends a test/status confirmation and offers a sample post flow.
9. The user may enable **Start with operating system**.
10. The setup window can be closed; the worker continues running in the background and remains available from the tray.

Credentials should be entered into the UI rather than requiring manual editing of `.env` for normal users. Environment variables may remain supported for development and advanced users.

### 4.2 Basic publishing flow

The user sends either:

- Text only: `Our new collection is live.`
- Text with images: a caption plus one or more attached images.
- Images with no caption: the post uses the images and an empty/optional text body, subject to Buffer and Facebook validation.

The app should treat a group of media messages sent together as one candidate post when WhatsApp delivers them as separate events. It should wait for a short, configurable collection window (for example, 3–5 seconds) after the latest related media event before publishing.

After publishing, the app replies in the same WhatsApp destination with:

- The result: posted, scheduled, queued, failed, or awaiting approval.
- The selected Facebook Page.
- The Buffer post identifier when available.
- A link to the published post when Buffer provides one.
- A concise actionable error and retry instruction when publishing fails.

### 4.3 Commands and controls

Retain the prototype's existing commands where practical:

| Command | Behavior |
|---|---|
| Plain text/media | Create a post using the text and attached media |
| `#at HH:MM <text>` | Schedule through Buffer for the next matching local time |
| `#draft <text>` | Save without publishing |
| `#profiles` | Show configured Buffer organizations/pages |
| `#ping` | Show worker and provider health |
| `#help` | Show supported commands |
| `#delete <postId>` | Delete where the selected provider/API supports it |

For media commands, the command can be included in the caption. The parser must never publish a malformed scheduling command as a normal post.

The tray UI should expose equivalent actions without requiring WhatsApp commands:

- Pause/resume publishing.
- Publish or discard a draft.
- Retry a failed post.
- Open the selected Buffer/Facebook destination.
- Re-run setup or change the active destination.
- View recent activity and logs.
- Quit the worker completely.

## 5. Input destination rules

### Default: self-chat

The default destination is the user's WhatsApp self-chat. The listener must only accept messages whose normalized JID matches the configured linked account identity. Both phone-number JID and LID forms should be recognized when WhatsApp exposes both.

Self-chat replies generated by the app must be marked as handled and must never be published again.

### Alternative: empty/private group

Some users may prefer an empty group as a content inbox. The application may support this as an explicit alternative, but it must not scan every group by default.

Requirements:

- The user must select the group during setup or settings.
- The configured group JID must be persisted and displayed in settings in a human-readable form.
- The app should warn that any member able to post in the group may create content for the Page.
- Group messages should be accepted only from an allowed sender policy:
  - default: the linked user's own messages only;
  - optional future mode: approved group members.
- Changing the destination requires confirmation to avoid accidentally publishing from the wrong chat.

## 6. Media requirements

### Supported first-release media

- JPEG, PNG, and WebP images where accepted by Buffer/Facebook.
- Multiple images in one post, preserving WhatsApp send order.
- Captions attached to the first image or sent as nearby text.
- Reasonable per-file and total-size limits with a clear error before publishing.

The exact size, count, and format limits must be determined from the current Buffer API and Facebook channel constraints during implementation. The app must validate limits locally before attempting to publish.

### Media processing

1. Receive the WhatsApp message event.
2. Detect text, image messages, captions, and media keys.
3. Group related messages into one post using message timestamps, grouping metadata where available, and a short collection window.
4. Download media to a private temporary directory.
5. Validate MIME type, file size, dimensions, and total payload size.
6. Apply only necessary normalization, such as converting unsupported formats or correcting orientation.
7. Upload or reference the media using the Buffer-supported media workflow.
8. Remove temporary files after the Buffer operation completes or after the retry policy expires.

The implementation must not assume that a local filesystem path can be passed to Buffer. The Buffer media-upload flow must be verified and isolated behind a provider interface. If Buffer cannot support the desired multi-image Facebook post shape, the app should report that limitation rather than silently publishing text only.

### Message grouping and duplicate protection

- A single WhatsApp message ID must be processed at most once.
- A media batch must have a stable local idempotency key based on its source chat and message IDs.
- Restarts must not republish an already completed batch.
- If the worker crashes during publishing, the next run should recover the batch as `unknown` and require a safe retry/verification path instead of blindly duplicating it.
- Old temporary media and abandoned batches must be cleaned up on a scheduled basis.

## 7. Publishing model

### Buffer-first

Buffer is the primary publishing provider because it provides the user's connected Facebook Page target and optional scheduling. The provider layer should retain the current modern GraphQL API integration and avoid the retired legacy Buffer REST API.

The provider interface should support at least:

```text
listOrganizations()
listChannels(organizationId)
validateTarget(target)
createPost({ text, media, channelId, publishAt })
getPostStatus(postId)
```

The current direct Facebook Graph API provider may remain available as an advanced/legacy option, but the desktop UX and media work should target Buffer first.

### Immediate and scheduled posts

- No schedule: publish immediately using Buffer's immediate/share-now mode.
- Schedule: use an absolute timestamp and show the timezone used.
- Scheduling in the past must be rejected or rolled to the next valid time according to the existing behavior, with the chosen behavior shown to the user.
- The UI should show Buffer's queue/plan errors without obscuring the original post content.

## 8. Desktop architecture

Separate the application into a long-running worker and a user interface:

```text
Desktop shell / tray UI
        ↕ local IPC or localhost API
Publisher worker
  ├─ WhatsApp adapter (Baileys)
  ├─ destination filter
  ├─ message/media normalizer
  ├─ post queue and state store
  ├─ Buffer provider
  ├─ retry/recovery manager
  └─ structured logger + health state
```

### Worker

The worker owns:

- The Baileys socket and persistent WhatsApp auth state.
- Incoming message filtering and message grouping.
- The publishing queue and idempotency state.
- Buffer API calls and retries.
- Temporary media lifecycle.
- The local health endpoint or IPC server.
- The authoritative application status.

The worker must be able to run without the tray UI. Closing the settings window must not stop publishing.

### Tray UI

The tray process owns:

- Tray icon and connection badge.
- First-run/setup screens.
- Settings and destination selection.
- Recent posts, drafts, failures, and queue state.
- Pause/resume and quit controls.
- Links to logs and Buffer/Facebook destinations.

The UI should communicate with the worker through a versioned local interface. It must not directly own the WhatsApp socket or duplicate provider logic.

### Technology direction

The existing project is an ES-module Node.js process. The desktop shell can be evaluated between Electron and Tauri, but the decision should prioritize:

- Reliable background startup on Windows, macOS, and Linux.
- Secure credential storage.
- Small operational surface for a single-user local application.
- Ability to keep the existing Node worker or migrate it cleanly.
- Tray behavior when the main window is closed.

The worker should remain independently runnable with `npm start` for development, debugging, and headless deployments.

## 9. Local data and state

A durable local store is required once media, retries, history, and a desktop UI exist. SQLite is a suitable default; JSON files may remain for simple migration compatibility.

Suggested records:

### Settings

- WhatsApp account identity and selected destination JID.
- Destination type: `self-chat` or `group`.
- Buffer organization ID and channel ID.
- Provider credentials reference, never the raw secret in ordinary logs.
- Timezone and default publishing mode.
- Startup and notification preferences.

### Post job

- Local job ID and idempotency key.
- Source chat JID.
- Source WhatsApp message IDs.
- Text/caption.
- Local media metadata and temporary-file references.
- Target Buffer organization/channel.
- State: `received`, `collecting`, `ready`, `draft`, `publishing`, `scheduled`, `published`, `failed`, `unknown`, or `discarded`.
- Retry count and last error.
- Buffer post ID/link when known.
- Created, updated, and completed timestamps.

Sensitive data such as access tokens and WhatsApp credentials should use the operating system's secure credential store where available. At minimum, permissions must restrict local auth and database files to the current user.

## 10. Reliability and failure handling

The app should fail safely and explain what happened.

- WhatsApp disconnect: show disconnected state, reconnect with bounded backoff, and keep queued jobs.
- WhatsApp logged out: stop publishing, notify the user, and require re-authentication.
- Buffer authentication failure: pause jobs and request credential repair.
- Buffer rate limit or plan limit: retain jobs and show when retry is possible.
- Media download failure: mark the job failed and provide a retry action.
- Unsupported media: do not publish a text-only post without explicit user confirmation.
- Network timeout after request submission: mark the result as `unknown`; verify with Buffer before retrying.
- Unexpected process exit: recover incomplete jobs on next startup.
- Shutdown: finish or safely persist the current job before exiting when possible.

Notifications should be quiet by default. The tray can show a badge and the WhatsApp reply remains the primary confirmation channel.

## 11. Security and privacy

- Accept messages only from the configured destination.
- Never log message bodies, image contents, API keys, or WhatsApp credentials by default.
- Redact tokens and sensitive IDs in debug logs where feasible.
- Use HTTPS for Buffer requests.
- Store WhatsApp auth state outside the source tree in packaged installations, with user-only file permissions.
- Delete downloaded media after its retention period.
- Provide a setting to clear local history, cached media, and logout WhatsApp.
- Make it explicit that content and media are sent to Buffer and then handled by Buffer/Facebook under their policies.
- Treat a group destination as a higher-risk configuration and require explicit confirmation.

## 12. Packaging and operating-system behavior

The installed application should provide:

- A per-user installation.
- Start-on-login registration that can be enabled or disabled.
- A tray icon even when the main window is closed.
- A visible way to open settings, pause the worker, view status, and quit.
- Clean uninstall behavior, with an explicit choice about retaining or deleting local auth/data.
- Log rotation so a long-running service cannot fill the disk.
- A development mode that runs the current CLI worker without packaging.

Platform-specific startup and tray behavior should be tested on the target operating systems before release. Windows is likely the first packaging target if the initial users are desktop Windows users.

## 13. Observability and diagnostics

The tray status view and local health endpoint should expose:

- Worker process state.
- WhatsApp connection state and last successful connection.
- Whether the configured destination matches the linked account/group.
- Buffer provider state and active Page.
- Queue depth and last successful/failed job.
- Last error with a user-safe explanation.
- Application version.

Provide an exportable diagnostic bundle containing sanitized logs and configuration metadata, but never raw credentials, message bodies, or media.

## 14. Delivery phases

### Phase 1 — Current prototype stabilization

- Keep the self-chat text flow working.
- Preserve Buffer target auto-detection and `#profiles`, `#draft`, `#at`, `#ping`, and `#help` behavior.
- Add durable job state and idempotency for text posts.
- Improve error messages and provider health reporting.

### Phase 2 — Image posts

- Add image extraction/download from Baileys.
- Implement text + image batch grouping.
- Verify Buffer's media-upload and Facebook multi-image capabilities.
- Add local validation, cleanup, retries, and WhatsApp confirmations.
- Add tests for captions, multiple images, unsupported media, duplicate events, and restart recovery.

### Phase 3 — Desktop worker and tray

- Split the worker lifecycle from the UI.
- Add local IPC/health API.
- Add setup wizard, secure settings, status, history, drafts, and pause/resume.
- Add tray icon and notifications.

### Phase 4 — Packaging and startup

- Package for the first target OS.
- Add start-on-login registration.
- Test upgrades, uninstall behavior, auth persistence, reconnects, and crash recovery.
- Add signed/reproducible release artifacts where practical.

### Phase 5 — Optional enhancements

- Empty-group destination support if not already included.
- Approval-before-publish mode.
- Post editing/templates.
- Additional channels/providers.
- Video support.

## 15. Acceptance criteria for the first complete release

A release is ready when a new user can:

1. Install and launch the app without a terminal.
2. Complete WhatsApp and Buffer setup from the UI.
3. Choose self-chat as the default destination.
4. Send a caption and multiple images in WhatsApp.
5. See one correctly ordered post appear on the selected Facebook Page through Buffer.
6. Receive a confirmation in WhatsApp and see the same job in tray history.
7. Restart the computer and have the worker start automatically when enabled.
8. Close the main window while the tray and worker continue operating.
9. Recover from a temporary network disconnect without creating duplicate posts.
10. See a clear failure and retry a post when Buffer rejects it.
11. Verify that messages from an unconfigured chat are ignored.
12. Disable startup, pause publishing, clear local media, and log out from the tray UI.

## 16. Open decisions

- Which desktop shell should be used: Electron or Tauri?
- Should the first release support Windows only, or Windows/macOS/Linux together?
- Does Buffer's current API support the desired multi-image Facebook post workflow directly, or is a provider-side media upload step required?
- Should publishing be automatic by default, or should first-run default to approval mode?
- What exact media count/size limits should be enforced?
- Should an empty group be supported in the first desktop release or immediately after self-chat support?
- Should scheduled posts use the local machine timezone, an explicit configured timezone, or Buffer's timezone?
- How long should completed job history and temporary media metadata be retained?
- Is direct Graph API support still needed after Buffer media publishing is complete?
