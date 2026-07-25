# PatLau Badminton Management System

PatLau is a role-based training operations system for managing badminton students, attendance, makeup credits, coaching schedules, and payments across several programmes. It is built with Next.js, React, TypeScript, Supabase, Telegram bots, and Brevo email delivery.

## Current capabilities

- Email or username authentication through Supabase
- Email reset-code and password-recovery flow
- Superuser, admin, and member access levels
- Shared navigation and account menu across authenticated pages
- User profile photos with camera/file selection, crop positioning, zoom controls, and default-icon fallback
- Weekend, weekday, MatchPlay, and 1-1 student management
- Attendance, missed-session, makeup, and undo workflows
- Cross-programme makeup credits with automatic top-up calculation
- Programme-specific payment tracking and monthly counters
- Coach attendance polls sent through Telegram
- Coach attendance reporting for individual coaches and administrators
- User creation, role management, Telegram-handle management, password reset, and account deletion
- Responsive data tables with contained horizontal scrolling
- Telegram payment notifications and scheduled payment summaries
- Telegram parent-support inbox, knowledge base, announcements, and escalation workflow
- Comprehensive audit trail with a durable Supabase delivery buffer, searchable Sentry Logs, actor attribution, safe before/after values, and a superuser activity viewer

## Technology

- Next.js 16 App Router
- React 19 and TypeScript
- Supabase Authentication, PostgreSQL, RPC functions, and row-level security
- Telegram Bot API integrations
- Brevo transactional email for reset codes
- Vercel-compatible scheduled routes

## Roles

### Superuser

Superusers can access all programme, payment, attendance, makeup, coach-attendance, and user-administration features. Destructive actions such as deleting students or users remain restricted to this role where implemented.

### Admin

Admins can perform the operational actions exposed by each page, including relevant attendance and coaching tasks. In Settings they can manage member accounts but cannot promote users to privileged roles.

### Member

Members receive the limited navigation and data access intended for coaches or regular users. Database row-level security remains the final authority even when the interface hides restricted controls.

## Application routes

| Route | Purpose |
| --- | --- |
| `/` | Sign in with an email address or username. |
| `/reset` | Request and verify a six-digit recovery code or set a new password from a valid recovery session. |
| `/signup` | Account-registration flow where enabled. |
| `/dashboard` | Search and filter weekend students, manage attendance, edit permitted student fields, and access programme navigation. |
| `/add` | Add a weekend student. |
| `/attendance` | Detailed weekend attendance and student-management view. |
| `/app/weekend/session-reports` | Searchable weekend session-attendance report with date and status summaries. |
| `/payment` | Weekend payment status, history, counters, undo, and Telegram notifications. |
| `/weekday/add` | Register a weekday student and one or more weekly sessions. |
| `/weekday/attendance` | Manage Monday, Wednesday, and Thursday attendance and makeup balances. |
| `/app/weekday/session-reports` | Searchable weekday session-attendance report grouped by date and scheduled day. |
| `/weekday/payment` | Calculate and track month-specific weekday payments. |
| `/matchplay` | MatchPlay programme overview. |
| `/matchplay/add` | Register a MatchPlay student with weeks and per-session pricing. |
| `/matchplay/attendance` | Track MatchPlay attendance and makeup activity. |
| `/app/matchplay/session-reports` | Searchable MatchPlay session-attendance report grouped by date and session. |
| `/matchplay/payment` | Track MatchPlay payments and monthly totals. |
| `/training/add` | Register and maintain 1-1 students and their payment amounts. |
| `/training` | Schedule monthly 1-1 coach-student pairings and record attendance. |
| `/app/training/session-reports` | Searchable 1-1 session-attendance report with student and coach details. |
| `/trngpayment` | Track payment for scheduled 1-1 sessions. |
| `/makeup` | Review makeup credits and usages across programmes. |
| `/makeup/payment` | Track makeup top-up payments and payment events. |
| `/coachattendance` | Create Saturday or Sunday Telegram coach-attendance polls. |
| `/myattendance` | Show the signed-in coach's confirmed shifts and estimated payment. |
| `/allattendance` | Administrative coach-attendance reporting. |
| `/chats` | Superuser parent-support inbox, chatbot knowledge, and time-sensitive announcements. |
| `/audit-logs` | Superuser-only searchable activity trail for database, authentication, payment, attendance, user, and delivery events. |
| `/settings` | View the current account and, when authorised, create and manage application users. |

## Attendance and makeup behaviour

Weekend attendance is stored against the `students` records. Programme-specific attendance uses separate tables for weekday, MatchPlay, and 1-1 sessions. The legacy `student_audit` history remains available, while the comprehensive `audit_logs` trail captures successful row changes across every current programme with actor and before/after context.

Each programme menu links to a responsive attendance report backed by the same Supabase tables used by the iOS app. Report and operational tables include a scoped refresh control that refetches only the relevant data, preserving the current route, filters, and selected date instead of reloading the entire page.

Weekend, Weekday, and MatchPlay attendance can be marked either through their normal current-session action or for any selected date before today. Alternate dates can fall on any weekday, but cannot be today, be in the future, or duplicate an existing attendance-history date. Weekday backdating retains the selected schedule row and session hours. The authenticated endpoints validate these rules again on the server and record a readable audit event.

The cross-programme makeup dialog uses Supabase RPC functions to find the latest available credit and complete its usage. It records:

- the source programme and missed lesson;
- the target programme and date;
- the source credit value;
- the target lesson value; and
- any top-up amount when the target costs more than the credit.

Weekday makeup values are calculated from the selected lesson duration at the configured hourly rate.

## Payment systems

Payment data is separated by programme:

- Weekend uses `payment_history` and `weekend_payment_period_state`.
- Weekday uses `weekday_payments` and the shared payment counter state.
- MatchPlay uses `matchplay_payments` and the shared payment counter state.
- 1-1 uses `training_payments` based on `one_to_one_sessions`.
- Makeup top-ups use `makeup_topup_payments`, `makeup_payment_events`, and `makeup_payment_counter_state`.

Payment routes support the relevant combination of monthly filtering, paid/unpaid state, counter reset, undo, and Telegram summary delivery.

## Coach attendance polling

`/coachattendance` creates a dated Saturday or Sunday poll and sends it through the coach-attendance Telegram bot. The webhook records responses in `coach_attendance_votes`, linked to `coach_attendance_polls`. Coach Telegram handles are maintained from Settings through `coach_profiles`.

The coach webhook validates Telegram's `X-Telegram-Bot-Api-Secret-Token` header. `TELEGRAM_COACH_ATTENDANCE_WEBHOOK_SECRET` is recommended; after changing it, register the same value as `secret_token` when calling Telegram's `setWebhook`. Existing installations may instead use the stable fallback derived from `TELEGRAM_PARENT_SUPPORT_WEBHOOK_SECRET`, but changing that parent secret also requires re-registering the coach webhook.

## Parent support chatbot

`/chats` is the superuser workspace for parent-support conversations, published knowledge, and time-sensitive announcements. The Telegram webhook answers general questions from published information and current announcements. When a personal or unsupported question, complaint, dispute, dissatisfied message, or request for a person needs Coach Patrick, the bot first asks the parent to confirm with **Yes, connect me** or **No, continue with AI**. Only a confirmed handoff notifies the Telegram support administrators and pauses the AI.

Parents may also send an image using Telegram's normal **Photo** option (not as an uncompressed file). Photos up to 5 MB are downloaded directly from Telegram into temporary server memory, checked for safe dimensions, and sent to the image-capable support model only for a fixed routing classification. The application sets `store: false`, and the image bytes are not written to Supabase, Sentry, or application logs; OpenAI's applicable API abuse-monitoring retention may still apply. Clearly routine schedule, date, venue, fee, and general-coaching images stay with the AI, whose answer must still come only from published knowledge and current announcements. Possible injury, medical, safety, abuse, complaint, refund, dispute, private-record, unreadable, uncertain, or failed-analysis images are escalated immediately to Coach Patrick. This is intentionally more conservative than the text confirmation flow. Superusers can deliberately open the original photo inside the authenticated Chats conversation; the Telegram bot token and private Telegram file reference are never returned to the browser.

Telegram messages begin directly with their useful content instead of a sender header. AI replies end with **This is an automated AI-generated message based on the information provided.** Coach Patrick replies are delivered exactly as written, without a sender label, personal-attribution footer, or command guidance appended to the text. A separate close button appears only after a substantive Coach reply to the latest parent message. `/status` uses parent-friendly wording such as **Escalated to Coach Patrick** instead of internal state names, while `/close` is accepted only after a complete Coach reply. Telegram's visible parent command menu is synchronized automatically to `/start`, `/help`, `/status`, and `/close`; `/human` and other unknown commands cannot bypass the AI-first confirmation. Natural-language requests to speak with Coach Patrick offer a Yes/No handoff, while text or photo messages involving injury, safety, complaints, disputes, refunds, or clear dissatisfaction are escalated immediately. The `/start` response tells parents to type their question and does not show a decision button. Resolution feedback is delayed until the third actual AI answer instead of appearing after every response. During a confirmed escalation or Coach Patrick takeover, the AI remains paused, including when the parent sends `/start` or a non-text message.

The Chats interface keeps parent, AI, Coach Patrick, and system messages visually and textually distinct. Superusers can take over or return an eligible conversation to the AI. The close action appears only after Coach Patrick has sent a substantive reply after the parent’s latest message; the server enforces the same rule and Telegram attaches its close button only to substantive Coach Patrick replies. A greeting or acknowledgement such as “Hi” does not enable closing, and a new parent message requires a fresh complete reply. Conversations closed by Coach Patrick can be reopened either with the AI or **as Coach Patrick** for a correction or follow-up. A parent-closed conversation can also be reopened as Coach Patrick when an important correction is necessary. Reopening as Coach notifies the parent, keeps the AI paused, and requires a new substantive follow-up before closing again. Telegram receives the same close notification with a **Reopen conversation** button, while sending a new parent message still reopens automatically for compatibility. The full history is retained across these status changes.

Parents can choose **Delete stored conversation** from `/help` or from a closed conversation. Telegram shows a separate irreversible confirmation before the server deletes that parent-owned conversation, its stored messages, and its status history from Supabase; stale controls and controls from another Telegram account or chat are rejected. The parent contact is retained so a later message can start a clean conversation. The acknowledgement is sent directly through Telegram and is not saved back into the deleted history. This action removes PatLau’s stored website copy, but it cannot erase messages already present in the parent’s Telegram client or telemetry that was previously exported under the audit-retention policy.

Website superusers can manage additional Telegram notification administrators from Settings. A prospective administrator sends `/myid` to the parent-support bot, the superuser adds the returned private numeric user ID, and the administrator then sends `/start` before using **Send test**. Every active database administrator receives escalation and managed-chat follow-up alerts independently, so one blocked account does not stop delivery to the others. Group and channel IDs are rejected to keep parent messages private. Telegram alert access does not grant website access to `/chats`; that still requires a Superuser website account. `TELEGRAM_PARENT_SUPPORT_ADMIN_CHAT_ID` remains an always-active deployment fallback during rollout and is added alongside the database-managed administrators. Remove that Vercel environment variable before pausing or deleting the matching account from Settings.

Escalation notifications include two distinct HTTPS links. `/open-in-app/chats?conversation=...` opens a PatLau-branded bridge that attempts the free `patlau://chats?conversation=...` custom scheme and falls back to the same website conversation when the app is unavailable. `/chats?conversation=...` always targets the website directly. The bridge validates the conversation UUID before opening either destination. If the website requires sign-in, it carries a strictly validated chat-only return path through login and then opens that exact conversation; invalid or unavailable conversation links never silently open a different parent’s chat.

## Audit trail

`audit_logs` is an append-only operational and security timeline. Database triggers cover inserts, updates, and deletes on the current public business tables, including changes made inside RPC functions. Server routes add understandable events for actions outside those tables, such as login attempts, password recovery, Auth user administration, profile photos, support actions, Telegram delivery, and scheduled summaries.

Readable presentation snapshots resolve database keys to the relevant student, parent, account, programme, period, date, and payment amount. The immutable recorded summary, record ID, and before/after evidence are preserved separately under Technical details. This makes entries such as payment-history sequence numbers or student UUIDs investigable without exposing those identifiers as the main activity headline. Existing presentation snapshots are not rewritten when a person is later renamed.

Attendance actions from `student_audit`, makeup payment events, and support status/message events are translated into readable semantic entries. Logging starts when the migration is installed; it does not reconstruct actions that happened earlier. Authentication endpoints enforce account and address-based request windows. Every allowed attempt is logged, while repeated notices for requests that are already blocked are grouped briefly to prevent log-flooding.

Supabase acts as the durable delivery buffer rather than the long-term search interface. Every audit insert creates a private export-state row in the same database transaction. A protected daily route leases bounded batches, emits them through the official `@sentry/nextjs` Logs SDK, retries failures, and marks a row delivered only after an audit-aware wrapper observes every leased ID and Sentry's native transport explicitly returns HTTP 2xx. With the default seven-day setting, the additional safety conditions make the effective minimum local age nine days. Pending, retrying, in-flight, and dead-letter rows are never pruned.

The audit viewer is available to superusers at `/audit-logs`. It supports search, category, outcome, action, and date filters with expandable change and request details for the recent Supabase buffer. It also shows export health, supports a manual **Export now** action, retries terminal failures only when a superuser deliberately exports, and can link to the longer searchable history in Sentry. Ordinary authenticated users and anonymous clients cannot query or mutate the underlying table or private queue; the viewer reads both through separately authorised server APIs.

Passwords, reset codes, tokens, cookies, authorisation values, photo contents, and full parent-chat messages are never copied into the audit payload. Free-form text and nested values receive another redaction pass before Sentry delivery. Actor email, request IP address, and a bounded user-agent string are retained because they are needed to investigate account and request activity; restrict the Sentry project to authorised operators and apply the organisation's retention/privacy policy.

The service role can only insert and read audit entries directly, not update, delete, or truncate them. Cleanup is possible only through a constrained security-definer function that deletes successfully exported rows after the safety windows. When a future migration adds another mutable public table, rerun `public.refresh_audit_triggers()` as the database owner during that migration, then revoke runtime execution again.

Sentry is an operational search and alerting service, not a permanent legal archive. Its searchable retention depends on the selected Sentry plan. If multi-year immutable history becomes necessary, add encrypted object storage as the durable archive and retain Sentry for investigation and alerts.

## Important API route groups

### Authentication and users

- `/api/auth/login`
- `/api/auth/send-reset-code`
- `/api/auth/verify-reset-code`
- `/api/auth/change-password`
- `/api/users/create`
- `/api/users/list`
- `/api/users/update`
- `/api/users/delete`
- `/api/users/resend-reset-code`
- `/api/profile/photo`

### Student search and auditing

- `/api/search`
- `/api/attendance-search`
- `/api/payment-search`
- `/api/audit/log-attendance`
- `/api/audit/events`
- `/api/audit/export`
- `/api/students/delete`

### Telegram delivery

- `/api/telegram-reminder`
- `/api/telegram-weekend-payment`
- `/api/telegram-weekday-payment`
- `/api/telegram-matchplay-payment`
- `/api/telegram-trngpayment`
- `/api/telegram-makeup-payment`
- `/api/telegram-coach-attendance/send`
- `/api/telegram-coach-attendance/webhook`
- `/api/telegram-parent-support/webhook`

### Scheduled summaries

- `/api/cron/monthly-payment-summaries`
- `/api/cron/makeup-payment-summary`
- `/api/cron/audit-log-drain`

Scheduled routes fail closed unless `CRON_SECRET` is configured and supplied as a bearer token.

## Environment variables

Create `.env.local` and configure only the integrations you use. Never commit real credentials.

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Password recovery email
BREVO_API_KEY=
BREVO_SENDER_EMAIL=

# General reminders
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_IDS=

# Shared or programme-specific payment delivery
TELEGRAM_CHAT_ID=
TELEGRAM_WEEKEND_PAYMENT_BOT_TOKEN=
TELEGRAM_WEEKEND_PAYMENT_CHAT_ID=
TELEGRAM_WEEKEND_PAYMENT_THREAD_ID=
TELEGRAM_WEEKEND_THREAD_ID=
TELEGRAM_WEEKDAY_PAYMENT_BOT_TOKEN=
TELEGRAM_WEEKDAY_THREAD_ID=
TELEGRAM_MATCHPLAY_PAYMENT_BOT_TOKEN=
TELEGRAM_MATCHPLAY_THREAD_ID=
TELEGRAM_TRNGPAYMENT_BOT_TOKEN=
TELEGRAM_TRNGPAYMENT_THREAD_ID=
TELEGRAM_MAKEUP_PAYMENT_BOT_TOKEN=
TELEGRAM_MAKEUP_PAYMENT_CHAT_ID=
TELEGRAM_MAKEUP_PAYMENT_THREAD_ID=

# Coach attendance bot and topics
TELEGRAM_COACH_ATTENDANCE_BOT_TOKEN=
TELEGRAM_COACH_ATTENDANCE_CHAT_ID=
TELEGRAM_COACH_ATTENDANCE_THREAD_ID=
TELEGRAM_COACH_ATTENDANCE_SATURDAY_THREAD_ID=
TELEGRAM_COACH_ATTENDANCE_SUNDAY_THREAD_ID=
# Optional dedicated webhook secret. If omitted, the server derives a stable
# coach webhook secret from TELEGRAM_PARENT_SUPPORT_WEBHOOK_SECRET.
TELEGRAM_COACH_ATTENDANCE_WEBHOOK_SECRET=
TELEGRAM_PARENT_SUPPORT_BOT_TOKEN=
TELEGRAM_PARENT_SUPPORT_WEBHOOK_SECRET=
# Optional legacy/deployment fallback. Additional recipients are managed from
# Settings and stored privately in telegram_support_admins.
TELEGRAM_PARENT_SUPPORT_ADMIN_CHAT_ID=
OPENAI_API_KEY=
# Optional. Falls back to OPENAI_SUPPORT_MODEL, then the application's default.
OPENAI_SUPPORT_IMAGE_MODEL=

# Scheduled route protection
CRON_SECRET=

# Sentry audit offload and error reporting
# Use the DSN from Sentry Project Settings > Client Keys (DSN).
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_ENVIRONMENT=production
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
SENTRY_ORG=
SENTRY_PROJECT=
# Optional: required only for readable production source-map uploads.
SENTRY_AUTH_TOKEN=
# Optional: paste the HTTPS URL of a saved Sentry Logs view.
SENTRY_AUDIT_SEARCH_URL=
# Optional tuning; defaults shown.
AUDIT_LOCAL_RETENTION_DAYS=7
AUDIT_EXPORT_BATCH_SIZE=200
AUDIT_EXPORT_MAX_BATCHES=20
# Leave false until a structured log record has been confirmed in Sentry Logs.
AUDIT_PRUNING_ENABLED=false
```

Keep `SENTRY_AUTH_TOKEN`, `SENTRY_DSN`, and server Supabase credentials in Vercel environment variables. Never prefix the auth token with `NEXT_PUBLIC_` or commit it. The browser DSN is intentionally public, but it does not grant access to read Sentry data.

### Sentry setup

1. Create a **Next.js** project in Sentry, or open the one already created.
2. In **Project Settings → Client Keys (DSN)**, copy the DSN into both `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` in Vercel.
3. Copy the organisation slug and project slug into `SENTRY_ORG` and `SENTRY_PROJECT`.
4. If production source maps are wanted, create a Sentry organisation auth token with release/source-map permissions and save it as the server-only `SENTRY_AUTH_TOKEN`. Audit export itself does not require this token.
5. In Sentry security/privacy settings, keep server-side data scrubbing enabled and add sensitive keys such as `password`, `token`, `secret`, `code`, `cookie`, `authorization`, `session`, and `api_key`.
6. Apply the Sentry audit migrations in filename order, including `20260721210000_cut_over_sentry_sdk_export.sql` and `20260721220000_make_audit_logs_human_readable.sql`, leave `AUDIT_PRUNING_ENABLED=false`, and redeploy the application. The cutover migration safely requeues retained rows that the retired raw sender had marked exported; the readable-logs migration resolves technical record keys into point-in-time names and operational context.
7. Open **Audit Logs → Test Sentry**. This sends one fresh log through the same tracked official SDK path used by real audit exports. Confirm that the page reports SDK initialized, SDK Logs enabled, SDK local queue drained, and Sentry transport accepted (2xx).
8. Copy the exact `source:patlau_sentry_probe probe_id:<id>` query shown by the test into Sentry **Explore → Logs** with the `patlau` project, **All Environments**, and a time range that includes the current time. The 2xx result proves ingestion accepted the SDK envelope; the probe appearing in Logs is the final proof that Sentry indexed it.
9. Use **Audit Logs → Export now**, then search the displayed `audit_export_run_id:<id>` token. SDK exports are timestamped when they are sent, while each record's original action time remains available in the `audit_occurred_at` attribute.
10. Save the working Logs view and place its HTTPS URL in `SENTRY_AUDIT_SEARCH_URL` if the website should link directly to it.
11. Create a Sentry alert for errors tagged `subsystem:audit-export`, and keep Vercel function-failure notifications enabled. This makes a broken exporter visible before the local queue grows substantially.
12. Only after verifying a probe and an audit export in Sentry Logs, set `AUDIT_PRUNING_ENABLED=true` in Vercel and redeploy. Until this switch is enabled, exports can be tested but no local audit row can be cleaned up.

The export route fails closed when the DSN is absent. In that state it does not acknowledge or prune any audit row, so configuring the website and Supabase in separate deployments does not lose history.

## Database setup

The application expects its Supabase tables, RPC functions, and RLS policies to exist before use. Versioned SQL currently included in the repository covers payment history, tracking-period setup, support chat, security hardening, and comprehensive audit logging:

- `migrations/20250719102000_create_payment_history.sql`
- `migrations/20250719102100_create_tracking_period.sql`
- `migrations/20260719090000_create_avatars_bucket.sql`
- `migrations/20260719110000_create_parent_support_chat.sql`
- `migrations/20260720133000_harden_database_security.sql`
- `migrations/20260720170000_create_comprehensive_audit_logs.sql`
- `migrations/20260720200000_create_sentry_audit_outbox.sql`
- `migrations/20260720210000_harden_sentry_audit_export.sql`
- `migrations/20260721210000_cut_over_sentry_sdk_export.sql`
- `migrations/20260721220000_make_audit_logs_human_readable.sql`
- `sql/setup_payment_history_rls.sql`
- `sql/setup_telegram_support_admins.sql`

The running application also references programme, makeup, coach-attendance, reset-code, profile, and payment-state tables. Keep the deployed Supabase schema and RPC definitions in sync with the codebase, and enforce permissions with RLS rather than relying only on hidden interface controls.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Validation commands:

```bash
npm test
npm run build
```

`npm test` runs the TypeScript check, parent-support flow regressions, human-readable audit-display regressions, and an in-memory Sentry transport regression covering official SDK envelopes, multi-envelope batches, row tracking, and non-2xx rejection. `npm run build` performs the optimised Next.js production build.

## Deployment checklist

- Configure all required Supabase, Brevo, Telegram, Sentry, and cron variables.
- Apply the required database tables, RPC functions, and RLS policies.
- Confirm the audit export queue has no dead-letter rows, use **Export now**, and find the same stable event ID in Sentry before relying on automatic pruning.
- Configure the coach-attendance Telegram webhook.
- Test login and recovery for each role.
- Test attendance, makeup, payment, undo, and reset workflows for every enabled programme.
- Test Settings permissions for superusers, admins, and members.
- Confirm wide tables scroll inside their cards at mobile and reduced desktop widths.
