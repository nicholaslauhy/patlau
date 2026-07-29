"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import AppHeader from "../components/AppHeader";
import TableRefreshButton from "../components/TableRefreshButton";
import { authenticatedFetch } from "../lib/authenticated-fetch";
import { type OperationsLinkTone } from "../lib/operations-access";
import type { UserRole } from "../lib/server-auth";
import type { OperationsSummary } from "../../types/operations";
import QuickWorkflows from "./QuickWorkflows";
import "./operations.css";

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const ROLE_COPY: Record<UserRole, { label: string; description: string }> = {
    superuser: {
        label: "Full operations view",
        description:
            "Review cross-programme work, payments, support, attendance, and administrative follow-ups.",
    },
    admin: {
        label: "Admin operations view",
        description:
            "Use the existing attendance, fixed-price student, coach-attendance, and 1-1 workflows.",
    },
    member: {
        label: "Attendance workspace",
        description:
            "Open the existing Weekend attendance and report workflows. No new administrative controls are exposed here.",
    },
};

type MetricCardProps = {
    label: string;
    value: number | string;
    detail: string;
    tone?: OperationsLinkTone;
    href?: string;
};

function MetricCard({
    label,
    value,
    detail,
    tone = "blue",
    href,
}: MetricCardProps) {
    const content = (
        <>
            <span className="operations-metric__label">{label}</span>
            <strong>{value}</strong>
            <span className="operations-metric__detail">{detail}</span>
            {href && <span className="operations-metric__open">Open workflow →</span>}
        </>
    );

    return href ? (
        <Link
            href={href}
            className={`operations-metric operations-tone--${tone}`}
        >
            {content}
        </Link>
    ) : (
        <article className={`operations-metric operations-tone--${tone}`}>
            {content}
        </article>
    );
}

export default function OperationsPage() {
    const router = useRouter();
    const [userId, setUserId] = useState("");
    const [userName, setUserName] = useState("");
    const [authReady, setAuthReady] = useState(false);
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [summary, setSummary] = useState<OperationsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let active = true;

        const loadUser = async () => {
            const { data, error: userError } = await supabase.auth.getUser();
            if (userError || !data.user) {
                router.push("/");
                return;
            }

            if (!active) return;
            setUserId(data.user.id);
            setUserName(
                data.user.user_metadata?.name
                || data.user.email?.split("@")[0]
                || "User",
            );
            setAuthReady(true);
        };

        void loadUser();
        return () => {
            active = false;
        };
    }, [router]);

    const loadSummary = useCallback(async () => {
        setLoading(true);
        setError("");

        try {
            const response = await authenticatedFetch("/api/operations/summary", {
                cache: "no-store",
            });
            const body = await response.json().catch(() => ({}));

            if (response.status === 401) {
                router.push("/");
                return;
            }
            if (!response.ok) {
                throw new Error(body.error || "The operations summary could not be loaded.");
            }

            const nextSummary = body as OperationsSummary;
            setSummary(nextSummary);
            setUserRole(nextSummary.role);
        } catch (loadError) {
            setError(
                loadError instanceof Error
                    ? loadError.message
                    : "The operations summary could not be loaded.",
            );
        } finally {
            setLoading(false);
        }
    }, [router]);

    useEffect(() => {
        if (authReady) void loadSummary();
    }, [authReady, loadSummary]);

    const roleCopy = userRole ? ROLE_COPY[userRole] : null;
    const weekend = summary?.weekend;
    const management = summary?.management;
    const superuser = summary?.superuser;

    return (
        <div className="container operations-page">
            <AppHeader
                title="Operations"
                userName={userName}
                userRole={userRole}
                mode="dashboard"
            />

            <main className="operations-main">
                <section className="operations-hero">
                    <div>
                        <span className="operations-eyebrow">Command centre</span>
                        <h1>Welcome back, {userName || "User"}</h1>
                        <p>
                            {roleCopy?.description
                                || "Loading your role-aware operations view…"}
                        </p>
                        <div className="operations-hero__meta">
                            {roleCopy && <span>{roleCopy.label}</span>}
                            {summary && <span>{summary.todayLabel}</span>}
                        </div>
                    </div>
                    <TableRefreshButton
                        onRefresh={loadSummary}
                        refreshing={loading}
                        label="Refresh operations summary"
                    />
                </section>

                {error && (
                    <div className="operations-notice operations-notice--error" role="alert">
                        <span>{error}</span>
                        <button type="button" onClick={() => void loadSummary()}>
                            Try again
                        </button>
                    </div>
                )}

                {summary?.warnings.map((warning) => (
                    <div
                        className="operations-notice operations-notice--warning"
                        role="status"
                        key={warning}
                    >
                        {warning}
                    </div>
                ))}

                <section className="operations-section">
                    <div className="operations-section__heading">
                        <div>
                            <span className="operations-eyebrow">Weekend programme</span>
                            <h2>Attendance readiness</h2>
                        </div>
                        <Link href="/dashboard">Open Weekend dashboard →</Link>
                    </div>

                    <div className="operations-metric-grid">
                        <MetricCard
                            label="Weekend students"
                            value={weekend?.totalStudents ?? "—"}
                            detail="Active roster shown on the existing dashboard"
                            href="/dashboard"
                        />
                        <MetricCard
                            label="Saturday roster"
                            value={weekend?.saturdayStudents ?? "—"}
                            detail="Students currently scheduled for Saturday"
                            tone="purple"
                        />
                        <MetricCard
                            label="Sunday roster"
                            value={weekend?.sundayStudents ?? "—"}
                            detail="Students currently scheduled for Sunday"
                            tone="green"
                        />
                        <MetricCard
                            label="Completed courses"
                            value={weekend?.completedCourses ?? "—"}
                            detail="Students who have used their configured lessons"
                            tone="slate"
                        />
                    </div>

                    <div className="operations-session-status">
                        <div>
                            <span className="operations-session-status__icon" aria-hidden="true">
                                {weekend?.todayLessonDay ? "✓" : "i"}
                            </span>
                            <div>
                                <strong>
                                    {weekend?.todayLessonDay
                                        ? `${weekend.todayLessonDay} attendance`
                                        : "No Weekend roster scheduled today"}
                                </strong>
                                <p>
                                    {weekend?.todayLessonDay
                                        ? `${weekend.todayRecorded} of ${weekend.todayScheduled} students have an attendance record for today.`
                                        : "Use the quick links below to prepare the next session or review earlier attendance."}
                                </p>
                            </div>
                        </div>
                        {weekend?.todayLessonDay && (
                            <div className="operations-session-status__count">
                                <strong>{weekend.todayRemaining}</strong>
                                <span>remaining</span>
                            </div>
                        )}
                    </div>
                </section>

                {superuser && (
                    <section className="operations-section">
                        <div className="operations-section__heading">
                            <div>
                                <span className="operations-eyebrow">Programme portfolio</span>
                                <h2>Weekday, MatchPlay and makeup</h2>
                                <p>
                                    Jump directly into each programme instead of
                                    treating them as a single follow-up total.
                                </p>
                            </div>
                        </div>
                        <div className="operations-metric-grid operations-metric-grid--three">
                            <MetricCard
                                label="Active Weekday students"
                                value={superuser.activeWeekdayStudents}
                                detail="Monday, Wednesday and Thursday training"
                                tone="blue"
                                href="/weekday/attendance"
                            />
                            <MetricCard
                                label="Active MatchPlay students"
                                value={superuser.activeMatchPlayStudents}
                                detail="MatchPlay attendance and student records"
                                tone="purple"
                                href="/matchplay/attendance"
                            />
                            <MetricCard
                                label="Available makeup credits"
                                value={superuser.availableMakeupCredits}
                                detail="Credits ready for cross-programme use"
                                tone="amber"
                                href="/makeup"
                            />
                        </div>
                    </section>
                )}

                {management && (
                    <section className="operations-section">
                        <div className="operations-section__heading">
                            <div>
                                <span className="operations-eyebrow">Admin workflows</span>
                                <h2>1-1 and coach coordination</h2>
                            </div>
                        </div>
                        <div className="operations-metric-grid operations-metric-grid--three">
                            <MetricCard
                                label="Active 1-1 students"
                                value={management.activeOneToOneStudents}
                                detail="Available in the existing 1-1 workflow"
                                tone="green"
                                href="/training/add"
                            />
                            <MetricCard
                                label="Upcoming 1-1 sessions"
                                value={management.upcomingOneToOneSessions}
                                detail="Scheduled in the next seven days"
                                tone="teal"
                                href="/training"
                            />
                            <MetricCard
                                label="Active coach polls"
                                value={management.activeCoachPolls}
                                detail="Current or upcoming Telegram attendance polls"
                                tone="purple"
                                href="/coachattendance"
                            />
                        </div>
                    </section>
                )}

                {superuser && (
                    <section className="operations-section">
                        <div className="operations-section__heading">
                            <div>
                                <span className="operations-eyebrow">Needs attention</span>
                                <h2>Superuser follow-ups</h2>
                            </div>
                        </div>
                        <div className="operations-metric-grid operations-metric-grid--three">
                            <MetricCard
                                label="Outstanding Weekend payments"
                                value={superuser.outstandingWeekendPayments}
                                detail="Weekend students not currently marked paid"
                                tone="amber"
                                href="/payment"
                            />
                            <MetricCard
                                label="Escalated parent chats"
                                value={superuser.escalatedParentChats}
                                detail="Conversations waiting for Coach Patrick"
                                tone="teal"
                                href="/chats"
                            />
                            <MetricCard
                                label="Unread parent messages"
                                value={superuser.unreadParentMessages}
                                detail="Unread messages across the support inbox"
                                tone="purple"
                                href="/chats"
                            />
                        </div>
                    </section>
                )}

                {userRole && userId && (
                    <QuickWorkflows role={userRole} userId={userId} />
                )}
            </main>
        </div>
    );
}
