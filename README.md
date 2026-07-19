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
| `/payment` | Weekend payment status, history, counters, undo, and Telegram notifications. |
| `/weekday/add` | Register a weekday student and one or more weekly sessions. |
| `/weekday/attendance` | Manage Monday, Wednesday, and Thursday attendance and makeup balances. |
| `/weekday/payment` | Calculate and track month-specific weekday payments. |
| `/matchplay` | MatchPlay programme overview. |
| `/matchplay/add` | Register a MatchPlay student with weeks and per-session pricing. |
| `/matchplay/attendance` | Track MatchPlay attendance and makeup activity. |
| `/matchplay/payment` | Track MatchPlay payments and monthly totals. |
| `/training/add` | Register and maintain 1-1 students and their payment amounts. |
| `/training` | Schedule monthly 1-1 coach-student pairings and record attendance. |
| `/trngpayment` | Track payment for scheduled 1-1 sessions. |
| `/makeup` | Review makeup credits and usages across programmes. |
| `/makeup/payment` | Track makeup top-up payments and payment events. |
| `/coachattendance` | Create Saturday or Sunday Telegram coach-attendance polls. |
| `/myattendance` | Show the signed-in coach's confirmed shifts and estimated payment. |
| `/allattendance` | Administrative coach-attendance reporting. |
| `/settings` | View the current account and, when authorised, create and manage application users. |

## Attendance and makeup behaviour

Weekend attendance is stored against the `students` records and audited through `student_audit`. Programme-specific attendance uses separate tables for weekday, MatchPlay, and 1-1 sessions.

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

## Important API route groups

### Authentication and users

- `/api/auth/login`
- `/api/auth/send-reset-code`
- `/api/auth/verify-reset-code`
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

### Scheduled summaries

- `/api/cron/monthly-payment-summaries`
- `/api/cron/makeup-payment-summary`

Protect scheduled routes with `CRON_SECRET` in production.

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

# Scheduled route protection
CRON_SECRET=
```

## Database setup

The application expects its Supabase tables, RPC functions, and RLS policies to exist before use. Versioned SQL currently included in the repository covers payment history and tracking-period setup:

- `migrations/20250719102000_create_payment_history.sql`
- `migrations/20250719102100_create_tracking_period.sql`
- `migrations/20260719090000_create_avatars_bucket.sql`
- `sql/setup_payment_history_rls.sql`

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

`npm test` currently runs TypeScript without emitting files. `npm run build` performs the optimised Next.js production build.

## Deployment checklist

- Configure all required Supabase, Brevo, Telegram, and cron variables.
- Apply the required database tables, RPC functions, and RLS policies.
- Configure the coach-attendance Telegram webhook.
- Test login and recovery for each role.
- Test attendance, makeup, payment, undo, and reset workflows for every enabled programme.
- Test Settings permissions for superusers, admins, and members.
- Confirm wide tables scroll inside their cards at mobile and reduced desktop widths.
