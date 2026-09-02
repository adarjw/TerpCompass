# ClassCompass

A local-first Expo/React Native app that answers one question — **"Where am I
supposed to be right now?"** — and helps a UMD student track attendance and
catch up after a missed class, entirely on-device.

## Running it locally

```bash
npm install
npx expo start
```

Then press `i` (iOS simulator), `a` (Android emulator), or scan the QR code
with Expo Go on a physical device. Web (`w`) also works, with the caveats
below.

Other useful commands:

```bash
npm test          # Vitest — pure logic (parsers, planner, importance, DST, etc.)
npm run typecheck  # tsc --noEmit
npm run lint       # expo lint (ESLint)
```

### Web preview caveat

The app targets iOS/Android. It also runs on web (`expo-sqlite` uses a wasm
build there), but two things behave differently on web:

- `Alert.alert` (used for destructive-action confirmations like "Delete
  course" or "Delete all local data") is a no-op in `react-native-web` — those
  buttons won't visibly prompt on web. They work normally on a real device.
- Local notifications are not supported on web at all; `expo-notifications`
  silently skips scheduling there. Test notification behavior on a simulator
  or device.

## Class notes & walking timer

**Timestamped class notes** — open a session (Schedule → a class → "Notes",
or the "Notes" button on Home's current/next class card) to jot plain-text
notes during or right after class. Each note is tagged with the wall-clock
time it was written, so the log reads as a timeline of the period. Stored
per-session in `class_notes` (`src/app/session/[id].tsx`).

**Photo notes** — "Raw photo" or "Cropped photo" on the note composer attaches
a picture (a whiteboard shot, a notebook page) to that session's notes.
"Cropped" auto-trims a margin off each edge and bakes in the photo's EXIF
orientation via `expo-image-manipulator`, entirely on-device
(`src/services/notePhoto.ts`); "Raw" stores the picked image untouched. Either
way the file lives in the app's private sandbox like any other resource.

**Schedule hints from notes** — typing something like "exam Thursday" or
"paper due next Monday" into a note is scanned for an exam/deadline keyword
paired with a day reference (`src/lib/noteSchedule.ts#detectScheduleHint`,
deterministic, same "never invent a date" rule as the syllabus/email
detectors). A match surfaces a confirm card under the composer — nothing is
added to `calendar_events` without an explicit tap, mirroring the
cancellation-detection flow below.

**Walking timer** — on Home's next-class card, "⏱ Time this walk" asks where
you're starting from (previous class, a South Campus dining hall,
Yahentamitsi, 251 North, your dorm, or a custom location), then runs a
stopwatch you stop when you arrive. Saved recordings feed back into future
walking estimates: `src/lib/walking.ts#estimateWalkWithRecordings` prefers
the average of your own timed walks for a route over the generic
straight-line guess, but only for the two starting points the app can infer
automatically (`previous_class` when today has an earlier class ending
within ~30 min beforehand, `dorm` otherwise) — it never guesses which of the
other locations you're currently at.

## Quiz/exam/homework dates from your syllabus

Uploading a syllabus already extracts dated schedule lines into chunks
(`src/lib/syllabus.ts#chunkResourceText`); `src/lib/syllabusDates.ts` scans
those chunks for a keyword — exam/midterm/final, quiz/test, or a
project/assignment/problem-set "due" — on the same line as a detected date,
classifying it as **Exam**, **Quiz**, or **Homework/Project**. Matches show
up in the Dashboard's **"Detected from your syllabi"** card with the source
filename and page cited, same as everywhere else detected content is shown.

Real syllabi format dates and event descriptions inconsistently, so there's
a windowed fallback: `chunkResourceText` isolates any date-bearing line into
its own small chunk, which means a two-line "Important Dates" list item
("10/15" on one line, "Midterm Exam" on the next) or a sentence hard-wrapped
across lines by PDF extraction ("The final exam is scheduled for\nDecember
15th...") splits the date and the keyword into separate chunks that would
otherwise never be compared. `detectSyllabusEvents` looks up to 2 chunks
either side, within the same resource, for a keyword — but only in
neighbors that have no detected date of their own, so a date sitting next to
a *different*, separately-dated schedule row is never misattributed.

This narrows, but doesn't eliminate, real gaps: a date and its keyword more
than 2 chunks apart, or a genuinely undated reference ("the exam" without a
date anywhere nearby), still won't match.

Borrowing a keyword across chunks is inherently riskier than matching it on
the dated line itself, so the cross-chunk fallback uses a **stricter**
keyword set than direct matching does (`NEIGHBOR_KIND_PATTERNS` vs
`KIND_PATTERNS`) — found the hard way: testing against the demo syllabus, a
"Midterm review session" line sat two chunks away from an attendance-policy
sentence mentioning "10% of the **final** grade," and the fallback initially
borrowed that unrelated "final" and misclassified the review session as an
exam. Bare "midterm"/"final" and a bare "due" are only trusted for a direct,
same-line match now — cross-chunk matching requires the less ambiguous
"exam", "quiz"/"test", or an explicit "problem set/homework/project ... due"
phrase. A quirk worth knowing on direct matches: "Midterm review session" is
deliberately *not* classified as the exam itself (the actual exam has its
own dated line) — only text that says "review" right after "midterm"/"final"
is excluded, so "Midterm exam" and "Final review" still both match normally.

Nothing is added to your calendar automatically. Each detected item has its
own **"Add to calendar"** button (writes one `calendar_events` row); once
added, that item is recognized by its generated title+date and drops off the
"detected" list so it isn't shown twice — it simply moves up into the
existing "Upcoming exams & deadlines" card above it. This same detector also
appears scoped to a single course on that course's own detail page, under
**"This week: quizzes, exams & homework (from syllabus)"**.

**Scoped to the current week, grouped by class, tap to check off**: both the
Dashboard card and the course-page section only show items whose date falls
in the current Mon–Sun week (`src/lib/time.ts#isSameWeek`) — a syllabus with
frequent quizzes/homework would otherwise dump the whole semester into one
list. On the Dashboard, items are grouped into a collapsible section per
class, with classes ordered by their most urgent item first (an exam this
week outranks a quiz outranks a homework item — see
`compareSyllabusEventPriority`). Tapping anywhere on an item (other than the
"Add to calendar" button) toggles it done — a lightweight personal
checklist, stored in the `syllabus_event_completions` table (keyed by the
resource chunk the item was detected from, since detected items aren't
persisted rows of their own). Unlike the date filter, "done" status doesn't
currently carry an item over into future weeks or hide it — it's a per-week
checkbox, not a running to-do list.

## Multi-section courses

A course can have more than one meeting pattern — e.g. a Lecture plus a
separate Discussion or Lab in a different room/time, matching how UMD
registrar data actually works (Testudo/ELMS export Lec, Dis, and Lab as
distinct rows or calendar events sharing one course code). Each pattern
generates its own sessions, notifications, and "Directions" link, while
attendance, resources, and catch-up plans stay attached to the course as a
whole. Edit a course's meeting patterns from Schedule → tap a course →
**Edit**.

Importers merge rows/events that share a course code into one course with
multiple patterns:
- **.ics**: a VEVENT's `SUMMARY` is scanned for a component keyword
  (Lec/Dis/Lab/Sem/Studio); events sharing a code become one course.
- **CSV**: add a `component` column and give Lecture/Discussion/Lab their
  own rows under the same `code`.
- **Pasted screenshot text**: rows starting with "Lec"/"Dis"/"Lab"/"Final"
  within one course's block become separate patterns ("Final: TBA" rows are
  skipped — nothing to schedule).

## One-tap directions

Every place a location is shown (Home's focus card, Course detail, Campus
buildings) has a single **Directions** button — no app-picker dialog. It
opens Apple Maps on iOS or Google Maps everywhere else
(`src/lib/walking.ts#bestMapUrl`), using stored building coordinates when
available or falling back to a named search near UMD.

## What works without any AI / API keys

Everything. The entire app — schedule import, the home "where am I supposed
to be" screen, local notifications, walking-time estimates, absence tracking,
resource storage and on-device text extraction, and catch-up plan generation
— runs with zero network calls, zero API keys, and zero paid services. Data
lives in a local SQLite database (`expo-sqlite`) and files live in the app's
private sandbox directory (`expo-file-system`).

The **deterministic local provider** (`src/lib/ai/localProvider.ts`, plus the
planner in `src/lib/plan.ts`) builds catch-up plans, quiz prompts, and
resource summaries by pattern-matching literal text in whatever you've
uploaded. It never invents a topic, reading, or page number — if it can't
find matching content for a missed session, it says so explicitly:

> "I could not confidently determine the missed material. Please select the
> topic or upload the relevant resource."

## What's optional (and off by default)

An **AI provider abstraction** (`src/lib/ai/`) exists so a smarter provider
can generate richer catch-up plans, quizzes, and summaries — but:

- It is **disabled by default**. Nothing is sent anywhere unless you opt in
  under Settings → AI assistance.
- The only implemented optional provider is a **local CLI provider**
  (`src/lib/ai/cliProvider.ts`) that shells out to a command you configure
  (e.g. the Claude CLI or Codex CLI) and passes it only the specific course
  materials you've attached — never your whole device, never credentials.
- **Reality check:** phone apps can't spawn OS processes. The CLI provider is
  wired for a future desktop/companion build; on iOS/Android it correctly
  reports itself unavailable and the app falls back to the local provider.
  This is intentional, not a bug — no paid or cloud AI service is required or
  implemented.
- All provider output is validated against a strict schema
  (`src/lib/ai/validate.ts`) before it's shown: any citation pointing at a
  file you didn't actually upload is stripped, and malformed output is
  rejected outright rather than displayed.

## Feature map

| Feature | File(s) |
|---|---|
| .ics / CSV / pasted-screenshot-text import | `src/lib/ics.ts`, `src/lib/csv.ts`, `src/lib/scheduleText.ts` |
| Class-session generation (recurring → concrete dates, DST-safe) | `src/lib/sessions.ts`, `src/lib/time.ts` |
| Home "where am I supposed to be" screen | `src/app/(tabs)/index.tsx` |
| Local notifications (morning summary, T-45/20/10, leave-now) | `src/services/notifications.ts` |
| Walking-time estimate + campus building database | `src/lib/walking.ts`, `src/lib/campus.ts`, `src/app/buildings.tsx` |
| Absence recording ("absence recovery task") | `src/app/absence/[sessionId].tsx` |
| Resource attach + local PDF/text extraction | `src/services/files.ts`, `src/lib/pdf.ts` |
| Professor/TA email autofill from a syllabus upload | `src/lib/syllabus.ts#detectContacts` |
| Deterministic catch-up plan builder | `src/lib/plan.ts`, `src/lib/syllabus.ts` |
| Attendance-importance meter (exam/quiz/policy detection) | `src/lib/importance.ts` |
| AI provider abstraction (local + opt-in CLI) | `src/lib/ai/` |
| Email / cancellation detection | `src/lib/email.ts`, `src/app/email.tsx` |
| Dashboard (missed classes, open plans, repeated topics) | `src/app/(tabs)/dashboard.tsx` |
| Quiz/exam/homework dates detected from syllabi | `src/lib/syllabusDates.ts`, `src/components/SyllabusEventCard.tsx` |
| JSON backup / restore, delete-all-data | `src/lib/backup.ts`, `src/app/(tabs)/settings.tsx` |
| Absence-notice email drafts (5 reason templates, mailto: hand-off) | `src/lib/emailDrafts.ts` |
| Timestamped class notes per session | `src/app/session/[id].tsx` |
| Photo notes (raw / auto-cropped) | `src/services/notePhoto.ts`, `src/app/session/[id].tsx` |
| Schedule hints detected from note text | `src/lib/noteSchedule.ts` |
| Walking timer → recorded-average estimate | `src/lib/walking.ts`, Home's `WalkTimerWidget` |
| SQLite schema + repositories | `src/db/` |

## Data model

SQLite tables (see `src/db/schema.ts`): `courses`, `meeting_patterns`,
`class_sessions`, `absences`, `resources`, `extracted_resource_chunks`,
`catch_up_plans`, `catch_up_tasks`, `notifications`, `campus_locations`,
`calendar_events`, `class_notes`, `walk_recordings`, `app_settings`. Each
`class_sessions` row carries its own building/room/pattern label, generated
from its `meeting_patterns` row at schedule-generation time.

Every extracted fact (reading, problem, quiz prompt) carries a citation —
source filename and page number when known — back to the resource it came
from. Nothing in a catch-up plan is shown without one, except the explicit
"I could not confidently determine..." fallback.

## Privacy & data controls

- Uploaded files are copied into the app's private sandbox directory and
  never transmitted anywhere by default.
- Settings → "Delete all local data" wipes the database and all sandboxed
  files.
- Settings → "Export JSON backup" / Import screen → "Restore JSON backup"
  round-trip your entire dataset; imports are structurally validated before
  anything is written.
- Pasted email text and `.eml` files are sanitized (HTML stripped, no script
  execution) before analysis, and analysis always shows a confirmation screen
  before touching your schedule.

## Web push notifications (opt-in relay)

A closed browser tab can't fire OS alarms, so the web/PWA build offers real
push notifications through the app's own tiny relay (`api/push/*` on the same
Vercel deployment — no third-party service):

- **Client**: `public/sw.js` shows pushes with a live countdown timer
  (`src/services/webpush.ts` subscribes via VAPID and mirrors the same plan
  the native scheduler uses (`src/lib/notificationPlan.ts`) to the relay on
  every schedule change). When a notification arrives, it appends the
  minutes-to-class; tapping it opens the home page with a live countdown card.
- **Relay**: `api/push/sync.ts` stores exactly one record per device — the push
  subscription plus pending reminder texts (future-only, nearest 60, ≤30 days
  out), replaced wholesale on each sync. `api/push/tick.ts` sends whatever is
  due within the next 60 seconds, deletes each reminder as it's sent, and
  deletes the whole record when the subscription is revoked (410/404) or stays
  empty 45+ days. Turning the toggle off deletes the record immediately.
- **Timing**: notifications fire within a 60-second window of their scheduled
  time. The client-side countdown timer ensures accurate display on arrival,
  even if the server notification is off by a minute or two.
- **Setup (one-time)**:
  1. Create a Blob store on the Vercel project (Storage → Blob)
  2. Add env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_TICK_SECRET`
     (and optionally `VAPID_CONTACT`). The public key is also hardcoded in
     `src/services/webpush.ts`.
  3. Set up external cron (recommended for reliable timing):
     - Go to https://cron-job.org/en/ and create a free account
     - Create a new Cron Job with:
       - **URL**: `https://your-vercel-deployment.vercel.app/api/push/tick?secret=YOUR_PUSH_TICK_SECRET`
       - **Schedule**: Every 1 minute
       - **Notification**: Check to alert on failures
     - (Alternatively, `api/push/tick.ts` is called every ~5 min by
       `.github/workflows/push-tick.yml` as a backup, though GitHub Actions
       cron is unreliable for frequent intervals)
- iPhone: requires iOS 16.4+ and the app added to the home screen; enable the
  toggle from inside the installed app.
- **Automatic sync, no manual refresh needed**: every schedule mutation
  (import, add/edit/delete a course, mark an absence, apply an email-detected
  change) calls `rescheduleNotifications()`, which re-syncs the full plan to
  the relay — see the call sites listed in `src/state/AppContext.tsx`'s
  `rescheduleNotifications`. `AppContext` also re-syncs once whenever the app
  opens (not just on data changes), so a relay outage or a silently failed
  sync self-heals the next time the student opens the app, without requiring
  them to touch their schedule or tap anything. The "Reschedule notifications"
  button in Settings exists only as a manual escape hatch — it should never be
  required for normal use.
- **Failure visibility**: `syncWebPush` checks the sync response status and
  `console.error`s on both HTTP failures and network errors — `fetch()` only
  rejects on network-level failures, so an unchecked call would silently
  treat a 4xx/5xx relay response as a successful sync. (This exact gap let a
  real incident — every sync after a device's first attempt failing with a
  500 from a Vercel Blob API change — go unnoticed until a user reported
  missing notifications.) `api/push/sync.test.ts` and `api/push/tick.test.ts`
  cover the specific failure mode (an overwrite of an existing blob path
  without `allowOverwrite: true`) as a regression guard.

## Trying it out

From the Home screen (when you have no classes yet), tap **"Load demo data
(UMD sample)"** to seed three realistic UMD-style courses across a semester
window centered on today, including a sample syllabus with dated topics —
enough to exercise the importance meter and catch-up-plan generation
immediately, without importing anything real.

## Testing notes

`npm test` covers the pure-logic layer with Vitest, including:

- Recurring session generation across DST spring-forward/fall-back
  transitions and holiday exclusions (`src/lib/sessions.test.ts`,
  `src/lib/time.test.ts`).
- `.ics` and CSV parsing, including malformed-input rejection
  (`src/lib/ics.test.ts`, `src/lib/csv.test.ts`).
- The catch-up planner's citation integrity — every citation in a generated
  plan traces back to an actually-provided source file
  (`src/lib/plan.test.ts`).
- The attendance-importance scorer (`src/lib/importance.test.ts`).
- Email cancellation/room-change/remote detection and HTML sanitization
  (`src/lib/email.test.ts`).
- Backup validation (`src/lib/backup.test.ts`).
- AI-provider output validation, including rejection of fabricated citations
  and inconsistent confidence/topic combinations (`src/lib/ai/validate.test.ts`).
- Absence-notice email draft generation for all 5 reason categories, mailto:
  encoding, and that private reasons (mental health) stay generic rather than
  inventing detail (`src/lib/emailDrafts.test.ts`).
- Recorded-walk averaging and route matching (`src/lib/walking.test.ts`).

UI flows (import → notification scheduling → absence → catch-up plan →
email draft → class notes → walking timer) were manually verified
end-to-end in the Expo web preview using the demo data seed.

## Architecture notes / gotchas

- **SQLite journal mode is `DELETE` (not `WAL`) on web.** `database.ts`
  picks the journal mode per platform. WAL defers writes to a log file that
  only merges into the main database on a checkpoint; on native that's fine
  (real file I/O), but wa-sqlite's web IndexedDB-backed VFS doesn't
  checkpoint on page unload, so an isolated write immediately followed by a
  reload can be silently lost. This is a single-writer, local-first app with
  no need for WAL's concurrent-reader benefit, so the safer default wins on
  web. Native keeps WAL.
- **Any screen with local `useState` seeded from `useApp().settings` (or
  other async-loaded context data) must gate on `ready` before mounting.**
  `settings` starts as `DEFAULT_SETTINGS` and only becomes the real
  persisted value after an async DB read resolves — after the provider's
  first render. A `useState(settings.foo)` initializer runs on that first
  render and never re-syncs later, so it permanently snapshots the
  pre-load default. `(tabs)/settings.tsx` fixed this by splitting into an
  outer component that returns `<Loading />` until `ready`, and an inner
  `SettingsForm` that only mounts afterward. Follow the same pattern for any
  new screen with editable fields seeded from context.
- **`expo-file-system`'s `File`/`Directory` classes have no web
  implementation** — every native method is a no-op stub there
  (`ExpoFileSystem.web.ts`), so constructing one throws. Native code
  (`services/files.ts`'s `resourcesDir`/`sandboxDir`) still uses them for a
  real sandbox directory on disk. Web instead stores picked bytes as BLOB
  rows in a `sandbox_blobs` table and hands out a synthetic
  `sandbox-blob://<id>` URI in their place; reading text/PDF bytes from a
  freshly picked file goes straight through the browser's `Blob`/`File` APIs
  instead, sidestepping the unsupported classes entirely. `SandboxImage`
  (`components/SandboxImage.tsx`) resolves a stored URI to something
  `<Image>` can render — a real `file://` path on native, or a freshly
  regenerated `data:` URI on web (unlike a `blob:` object URL, that survives
  a reload since it's rebuilt from durably stored bytes each time).
