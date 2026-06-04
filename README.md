# Badminton Attendance and Expense Tracking Website

A web-based management system for a badminton training group. The website helps administrators manage student records, attendance, payments, 1-on-1 training sessions, user roles, and Telegram notifications from one central dashboard. 

The app is built with Next.js and Supabase. Supabase is used for authentication, user role management, database storage, and row-level security.Telegram bots are used to send payment and attendance-related notifications to a group chat. 

---

## Main Features 

- User login and authentication 
- Role-based access control and superusers, admins and members
- Student record management 
- Attendance tracking 
- Missed lesson and makeup lesson handling 
- Payment tracking and payment history 
- 1-on-1 training scheduling 
- 1-on-1 payment tracking 
- Telegram notification integration
- User settings and account management 

---

## User roles 

### Superuser 

Superusers have the highest level of access. They can manage student records, update student fields, reset courses, delete students, access payment pages, manage 1-on-1 training payments, and access admin-level settings. 

### Admin 

Admins can view student records and perform attendance-related actions such as marking attendance, marking missed lessons, recording makeup lessons, and undoing attendance actions. They do not have full destructive access such as deleting students or resetting courses unless explicitly allowed. 


### Member 

Members have limited access. They can view the dashboard and perform basic attendance-related actions if allowed by the current row-level security policies. They should not be able to access superuser-only payment or admin pages.

---

## Directory Overview

### `/`

The login page of the website.

Users land here before entering the system. The page handles authentication and redirects logged-in users to the relevant authenticated area.

Main purpose:

- User login
- Authentication entry point
- Redirect users after login

### `/dashboard`

The main student dashboard.

This is the central page for viewing student records and handling quick attendance actions. It displays students in a table with fields such as name, day, timeslot, level, attended count, missed count, actions, and attendance history.

Main purpose:

- View all student records
- Filter students by day, timeslot, and level
- Search for students
- Mark attendance
- Mark missed lessons
- Record makeup lessons
- Undo attendance actions
- View attendance history
- Allow superusers to edit student fields
- Allow superusers to reset or delete student records

Attendance history behaviour:

- `Mark` adds the current date
- `Missed` adds the current date with `(missed)`
- `Makeup` replaces the latest missed record with the current date and `(makeup)`
- `Undo` reverses the latest valid attendance-related action

---

### `/attendance`

A more detailed attendance management page.

This page is focused on attendance tracking and history management. It is mainly intended for superusers who need a more complete view of student attendance, lesson counts, pricing, weeks, and attendance records.

Main purpose:

- View detailed attendance records
- Update attendance counts
- Mark attendance
- Mark missed lessons
- Convert missed lessons into makeup lessons
- Undo attendance actions
- View detailed attendance history
- Edit student-related training details such as day, timeslot, level, price, and weeks

---

### `/payment`

The main payment tracking page for regular group training.

This page tracks whether students have paid for their training package. It calculates total collected payments, records payment history, and sends Telegram notifications when payment status changes.

Main purpose:

- View student payment status
- Mark students as paid or unpaid
- Track total payments collected
- Store payment history
- Send payment notifications to Telegram
- Reset payment totals for a new tracking period
- Undo the latest payment addition

This page does not manage attendance history directly.

---

### `/training`

The 1-on-1 training scheduling page.

This page is used to assign students to coaches for specific Sunday 1-on-1 training sessions. The layout is designed around coach-to-student pairing so that it is clear which coach is assigned to which student.

Main purpose:

- View Sundays for the selected month
- Add 1-on-1 training sessions
- Assign a coach to a student
- Update coach-student pairings
- Remove a student from a 1-on-1 training date

Expected pairing format:

```text
Coach → Student
```

---

### `/trngpayment`

The 1-on-1 payment tracking page.

This page is separate from the normal `/payment` page. It tracks payment for 1-on-1 training sessions based on scheduled sessions from `/training`.

Main purpose:

- View 1-on-1 sessions for the selected month
- Track paid and unpaid 1-on-1 sessions
- Calculate total 1-on-1 payments collected
- Send Telegram notifications using the 1-on-1 payment bot
- Reset monthly 1-on-1 payment totals
- Undo the latest 1-on-1 payment update

Telegram flow:

```text
/trngpayment
→ /api/telegram-trngpayment
→ 1-on-1 payment bot token
→ Telegram group chat
```

---

### `/settings`

The user settings and account management page.

This page allows users to view and update account-related information, depending on their role. Superusers may have access to more settings than admins or members.

Main purpose:

- View account details
- Update user settings
- Manage user-related options
- Allow logout
- Restrict sensitive role changes

---

## API Routes

The website uses several backend API routes to safely perform server-side actions.

### `/api/search`

Searches student records from the dashboard.

Used by:

- `/dashboard`

---

### `/api/attendance-search`

Searches student records from the attendance page.

Used by:

- `/attendance`

---

### `/api/payment-search`

Searches student records from the payment page.

Used by:

- `/payment`

---

### `/api/audit/log-attendance`

Logs attendance-related actions into the `student_audit` table.

Used for:

- `mark`
- `missed`
- `makeup`
- `undo`
- `reset`
- `delete`

This audit trail is important because undo logic depends on previous attendance actions.

---

### `/api/students/delete`

Deletes a student record.

This should only be available to superusers.

---

### `/api/telegram-reminder`

Sends Telegram messages using the general Telegram notification bot.

Used by:

- Regular payment notifications
- General reminders
- Payment summaries

---

### `/api/telegram-trngpayment`

Sends Telegram messages using the dedicated 1-on-1 payment bot.

Used by:

- `/trngpayment`

This route should use a separate bot token:

```env
TELEGRAM_TRNGPAYMENT_BOT_TOKEN=your_1_on_1_payment_bot_token
TELEGRAM_CHAT_ID=your_group_chat_id
```

---

### `/api/users/list`

Fetches the list of app users.

Used by:

- `/training`

This is used to populate the coach dropdown.

---

### `/api/create-payment-table`

Ensures payment history storage exists before recording payment history.

Used by:

- `/payment`

---

## Database Tables

### `students`

Stores the main student records.

Common fields include:

- `student_id`
- `student_name`
- `student_day`
- `student_timeslot`
- `student_levelofplay`
- `attended`
- `missed`
- `total_weeks`
- `price`
- `paid`
- `attendance_records`
- `created_at`
- `updated_at`

Important note:

`attendance_records` should be stored as `text[]`, not `timestamp with time zone[]`, because the system stores labelled attendance records such as:

```text
2026-06-04T15:21:58.497Z
2026-06-04T15:21:58.497Z|missed
2026-06-04T15:21:58.497Z|makeup|2026-06-01T10:00:00.000Z
```

---

### `student_audit`

Stores the history of attendance-related actions.

Common fields include:

- `id`
- `student_id`
- `action`
- `created_at`
- `user_id`

This table supports undo logic. Every undo action should also be logged, so the system knows which previous action has already been reversed.

---

### `payment_history`

Stores regular training payment records.

Common fields include:

- `id`
- `student_id`
- `amount`
- `recorded_at`

Used by `/payment`.

---

### `training_sessions`

Stores 1-on-1 training sessions.

Common fields include:

- `id`
- `session_date`
- `student_id`
- `coach_id`
- `created_at`
- `updated_at`

Used by `/training` and `/trngpayment`.

---

### `training_payments`

Stores 1-on-1 payment status.

Common fields include:

- `id`
- `training_student_id`
- `week_date`
- `paid`
- `created_at`
- `updated_at`

Used by `/trngpayment`.

---

## Environment Variables

Create a `.env.local` file with the required Supabase and Telegram values.

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

TELEGRAM_BOT_TOKEN=your_general_telegram_bot_token
TELEGRAM_PAYMENT_BOT_TOKEN=your_payment_bot_token
TELEGRAM_TRNGPAYMENT_BOT_TOKEN=your_1_on_1_payment_bot_token
TELEGRAM_CHAT_ID=your_telegram_group_chat_id
```

Keep all bot tokens private. Do not commit `.env.local` to GitHub.

---

## Telegram Setup

The app can send notifications to Telegram group chats through bots.

Recommended setup:

- One group chat for all badminton notifications
- One general bot for reminders
- One payment bot for normal payment updates
- One 1-on-1 payment bot for `/trngpayment`

The same Telegram group can be reused by all bots using the same `TELEGRAM_CHAT_ID`.

---

## Access Control and RLS

Supabase Row Level Security should be configured so that:

- Superusers can view and manage all relevant tables
- Admins can view students and perform attendance actions
- Members can view allowed student records and perform allowed attendance actions
- Only superusers can delete students or access sensitive payment/admin areas

The frontend hides buttons based on role, but RLS should still enforce the actual security rules on the database side.

---

## Running the Project Locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the app in the browser:

```text
http://localhost:3000
```

---

## Deployment Notes

Before deploying:

- Confirm `.env.local` values are correctly set in the deployment platform
- Confirm Supabase RLS policies are active
- Confirm Telegram bot tokens are valid
- Confirm `attendance_records` is `text[]`
- Test login for all roles: superuser, admin, member
- Test attendance actions from `/dashboard`
- Test detailed attendance from `/attendance`
- Test payment notifications from `/payment`
- Test 1-on-1 payment notifications from `/trngpayment`

---

## Summary

This website is a full badminton class management system. It centralises student tracking, attendance, payments, 1-on-1 training, role-based access control, and Telegram notifications so that the badminton group can manage operations more easily from one place.
embers have limited access. They can view the dashboard and perform basic attendance-related actions if allowed by the current row-level security policies. They should not be able to access superuser-only payment or admin pages.

