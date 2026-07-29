import { NextResponse } from "next/server";
import {
    getAuthenticatedUser,
    getStoredUserRole,
    serverAdmin,
} from "../../../lib/server-auth";
import {
    attendanceRecordDateKey,
    singaporeDateKey,
} from "../../../lib/weekend-attendance-date";
import type { OperationsSummary } from "../../../../types/operations";

export const dynamic = "force-dynamic";

const addDays = (dateKey: string, days: number) => {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, "0"),
        String(date.getUTCDate()).padStart(2, "0"),
    ].join("-");
};

const singaporeDayName = (date = new Date()) =>
    new Intl.DateTimeFormat("en-SG", {
        timeZone: "Asia/Singapore",
        weekday: "long",
    }).format(date);

const singaporeDateLabel = (date = new Date()) =>
    new Intl.DateTimeFormat("en-SG", {
        timeZone: "Asia/Singapore",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    }).format(date);

export async function GET(request: Request) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const role = getStoredUserRole(user);
    const now = new Date();
    const todayDateKey = singaporeDateKey(now);
    const dayName = singaporeDayName(now);
    const todayLessonDay =
        dayName === "Saturday" || dayName === "Sunday" ? dayName : null;

    const studentsResult = await serverAdmin
        .from("students")
        .select(
            "student_day,attended,missed,total_weeks,attendance_records,paid",
        );

    if (studentsResult.error) {
        return NextResponse.json(
            { error: "The Weekend operations summary could not be loaded." },
            { status: 500 },
        );
    }

    const students = studentsResult.data || [];
    const todayStudents = todayLessonDay
        ? students.filter((student) => student.student_day === todayLessonDay)
        : [];
    const todayRecorded = todayStudents.filter((student) =>
        Array.isArray(student.attendance_records)
        && student.attendance_records.some(
            (record) => attendanceRecordDateKey(record) === todayDateKey,
        )
    ).length;
    const completedCourses = students.filter((student) => {
        const totalWeeks = Number(student.total_weeks || 0);
        return totalWeeks > 0
            && Number(student.attended || 0) + Number(student.missed || 0)
            >= totalWeeks;
    }).length;

    const warnings: string[] = [];
    let management: OperationsSummary["management"] = null;
    let superuser: OperationsSummary["superuser"] = null;

    if (role === "admin" || role === "superuser") {
        const [oneToOneStudentsResult, sessionsResult, pollsResult] =
            await Promise.all([
                serverAdmin
                    .from("one_to_one_students")
                    .select("id", { count: "exact", head: true })
                    .eq("active", true),
                serverAdmin
                    .from("one_to_one_sessions")
                    .select("id")
                    .or("removed_from_training.is.null,removed_from_training.eq.false")
                    .gte("session_date", todayDateKey)
                    .lte("session_date", addDays(todayDateKey, 7)),
                serverAdmin
                    .from("coach_attendance_polls")
                    .select("id", { count: "exact", head: true })
                    .eq("active", true)
                    .gte("poll_date", todayDateKey),
            ]);

        if (
            oneToOneStudentsResult.error
            || sessionsResult.error
            || pollsResult.error
        ) {
            warnings.push(
                "Some 1-1 or coach-attendance totals are temporarily unavailable.",
            );
        }

        management = {
            activeOneToOneStudents: oneToOneStudentsResult.error
                ? 0
                : oneToOneStudentsResult.count || 0,
            upcomingOneToOneSessions: sessionsResult.error
                ? 0
                : sessionsResult.data?.length || 0,
            activeCoachPolls: pollsResult.error ? 0 : pollsResult.count || 0,
        };
    }

    if (role === "superuser") {
        const [supportResult, weekdayResult, matchPlayResult, makeupCreditsResult] =
            await Promise.all([
                serverAdmin
                    .from("support_conversations")
                    .select("status,unread_count"),
                serverAdmin
                    .from("weekday_students")
                    .select("id", { count: "exact", head: true })
                    .eq("active", true),
                serverAdmin
                    .from("matchplay_students")
                    .select("id", { count: "exact", head: true })
                    .eq("active", true),
                serverAdmin
                    .from("makeup_credits")
                    .select("id", { count: "exact", head: true })
                    .eq("status", "available"),
            ]);

        if (supportResult.error) {
            warnings.push("Parent-support totals are temporarily unavailable.");
        }
        if (weekdayResult.error || matchPlayResult.error) {
            warnings.push("Some programme totals are temporarily unavailable.");
        }
        if (makeupCreditsResult.error) {
            warnings.push("The available makeup-credit total is temporarily unavailable.");
        }

        const supportConversations = supportResult.data || [];
        superuser = {
            outstandingWeekendPayments: students.filter(
                (student) => student.paid !== true,
            ).length,
            escalatedParentChats: supportResult.error
                ? 0
                : supportConversations.filter(
                    (conversation) => conversation.status === "escalated",
                ).length,
            unreadParentMessages: supportResult.error
                ? 0
                : supportConversations.reduce(
                    (total, conversation) =>
                        total + Number(conversation.unread_count || 0),
                    0,
                ),
            activeWeekdayStudents: weekdayResult.error
                ? 0
                : weekdayResult.count || 0,
            activeMatchPlayStudents: matchPlayResult.error
                ? 0
                : matchPlayResult.count || 0,
            availableMakeupCredits: makeupCreditsResult.error
                ? 0
                : makeupCreditsResult.count || 0,
        };
    }

    const summary: OperationsSummary = {
        role,
        generatedAt: now.toISOString(),
        todayDateKey,
        todayLabel: singaporeDateLabel(now),
        weekend: {
            totalStudents: students.length,
            saturdayStudents: students.filter(
                (student) => student.student_day === "Saturday",
            ).length,
            sundayStudents: students.filter(
                (student) => student.student_day === "Sunday",
            ).length,
            completedCourses,
            todayLessonDay,
            todayScheduled: todayStudents.length,
            todayRecorded,
            todayRemaining: Math.max(0, todayStudents.length - todayRecorded),
        },
        management,
        superuser,
        warnings,
    };

    return NextResponse.json(summary, {
        headers: { "Cache-Control": "private, no-store" },
    });
}
