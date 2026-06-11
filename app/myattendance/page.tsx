"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import AppHeader from "./../components/AppHeader";
import "./../styles.css";
import "./../dashboard/dashboard.css";

type UserRole = "superuser" | "admin" | "member";
type AttendanceSource = "telegram" | "one_to_one";

interface AttendanceVote {
    id: number;
    poll_id: string;
    date_key: string;
    telegram_handle: string | null;
    display_name: string | null;
    response: string;
    updated_at: string;
    coach_attendance_polls?: {
        intro_text: string;
        venue_text: string;
        active: boolean;
        created_at: string;
    };
}

interface OneToOneSession {
    id: number;
    session_date: string;
    student_id: string;
    coach_id: string;
    removed_from_training?: boolean;
    removed_at?: string | null;
    payment_exempt?: boolean;
    payment_exempt_at?: string | null;
    attendance_status?: "scheduled" | "attended" | "missed" | "makeup";
    updated_at?: string;
}

interface AttendanceItem {
    id: string;
    source: AttendanceSource;
    dateKey: string;
    updatedAt: string;
    statusLabel: string;
}

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const normalizeHandle = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return "";
    return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
};

const normalizeDateKey = (dateValue: string) => dateValue.slice(0, 10);

const getNextMonthDateKey = (monthValue: string) => {
    const [yearStr, monthStr] = monthValue.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);

    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    return `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
};

const parseDateKey = (dateKey: string) => {
    const cleanKey = dateKey.trim();

    const isoMatch = cleanKey.match(
        /^(\d{4})-(\d{2})-(\d{2})(?:-(\d{1,2})-(\d{1,2}))?$/,
    );

    if (isoMatch) {
        const [, year, month, day, startHourRaw, endHourRaw] = isoMatch;
        return {
            year,
            month,
            day,
            startHourRaw,
            endHourRaw,
        };
    }

    // Handles Telegram-style date keys such as 13/6/2026 or 13/06/2026.
    const slashMatch = cleanKey.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:-(\d{1,2})-(\d{1,2}))?$/,
    );

    if (slashMatch) {
        const [, dayRaw, monthRaw, year, startHourRaw, endHourRaw] = slashMatch;
        return {
            year,
            month: monthRaw.padStart(2, "0"),
            day: dayRaw.padStart(2, "0"),
            startHourRaw,
            endHourRaw,
        };
    }

    return null;
};

const getShiftDetails = (
    dateKey: string,
    source: AttendanceSource = "telegram",
) => {
    const parsed = parseDateKey(dateKey);

    if (!parsed) {
        return {
            dateLabel: dateKey,
            timeLabel: "Timing unavailable",
            payment: 0,
            monthKey: "",
        };
    }

    const { year, month, day, startHourRaw, endHourRaw } = parsed;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    const dayOfWeek = date.getDay();
    const monthKey = `${year}-${month}`;

    const dateLabel = date.toLocaleDateString("en-SG", {
        day: "numeric",
        month: "long",
        year: "numeric",
    });

    if (source === "one_to_one") {
        return {
            dateLabel,
            timeLabel: "1-1 session",
            payment: 40,
            monthKey,
        };
    }

    // Saturday polls do not contain a timing key.
    // Every Saturday coaching shift is automatically 2-6pm at S$70.
    if (!startHourRaw || !endHourRaw) {
        if (dayOfWeek === 6) {
            return {
                dateLabel,
                timeLabel: "2-6pm",
                payment: 70,
                monthKey,
            };
        }

        return {
            dateLabel,
            timeLabel: "Timing unavailable",
            payment: 0,
            monthKey,
        };
    }

    const startHour = Number(startHourRaw);
    const endHour = Number(endHourRaw);
    const shiftKey = `${startHour}-${endHour}`;

    const shiftRules: Record<string, { label: string; payment: number }> = {
        "8-12": { label: "8am-12pm", payment: 70 },
        "1-5": { label: "1-5pm", payment: 70 },
        "12-1": { label: "12-1pm", payment: 40 },
        "10-12": { label: "10-12pm", payment: 35 },
        "2-6": { label: "2-6pm", payment: 70 },
    };

    const rule = shiftRules[shiftKey];

    return {
        dateLabel,
        timeLabel: rule?.label || `${startHour}-${endHour}`,
        payment: rule?.payment || 0,
        monthKey,
    };
};

const money = (value: number) => `S$${Number(value || 0).toFixed(2)}`;

export default function MyAttendancePage() {
    const router = useRouter();
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [userName, setUserName] = useState("");
    const [currentUserId, setCurrentUserId] = useState("");
    const [telegramHandle, setTelegramHandle] = useState("");
    const [attendanceItems, setAttendanceItems] = useState<AttendanceItem[]>([]);
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const date = new Date();
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    });

    const loadAttendance = useCallback(
        async (handle: string, coachId: string) => {
            if (!handle && !coachId) {
                setAttendanceItems([]);
                return;
            }

            const startDateKey = `${selectedMonth}-01`;
            const endDateKey = getNextMonthDateKey(selectedMonth);
            const normalizedHandle = normalizeHandle(handle);
            const handleWithoutAt = normalizedHandle.replace("@", "");

            const votePromise = normalizedHandle
                ? supabase
                    .from("coach_attendance_votes")
                    .select(
                        "*, coach_attendance_polls(intro_text, venue_text, active, created_at)",
                    )
                    .eq("response", "yes")
                    .or(
                        `telegram_handle.ilike.${normalizedHandle},telegram_handle.ilike.${handleWithoutAt}`,
                    )
                    .order("updated_at", { ascending: false })
                : Promise.resolve({ data: [], error: null });

            const oneToOnePromise = coachId
                ? supabase
                    .from("one_to_one_sessions")
                    .select(
                        "id, session_date, student_id, coach_id, removed_from_training, removed_at, payment_exempt, payment_exempt_at, attendance_status, updated_at",
                    )
                    .eq("coach_id", coachId)
                    .or("removed_from_training.is.null,removed_from_training.eq.false")
                    .gte("session_date", startDateKey)
                    .lt("session_date", endDateKey)
                    .order("session_date", { ascending: true })
                    .order("id", { ascending: true })
                : Promise.resolve({ data: [], error: null });

            const [voteResult, oneToOneResult] = await Promise.all([
                votePromise,
                oneToOnePromise,
            ]);

            if (voteResult.error) throw voteResult.error;
            if (oneToOneResult.error) throw oneToOneResult.error;

            const telegramItems = ((voteResult.data || []) as AttendanceVote[])
                .filter((vote) => {
                    const details = getShiftDetails(vote.date_key, "telegram");
                    return details.monthKey === selectedMonth;
                })
                .map((vote) => ({
                    id: `telegram-${vote.id}`,
                    source: "telegram" as AttendanceSource,
                    dateKey: vote.date_key,
                    updatedAt: vote.updated_at,
                    statusLabel: "Attending",
                }));

            const oneToOneItems = (
                (oneToOneResult.data || []) as OneToOneSession[]
            ).map((session) => ({
                id: `one-to-one-${session.id}`,
                source: "one_to_one" as AttendanceSource,
                dateKey: normalizeDateKey(session.session_date),
                updatedAt: session.updated_at || session.session_date,
                statusLabel: "1-1 Coaching",
            }));

            setAttendanceItems([...telegramItems, ...oneToOneItems]);
        },
        [selectedMonth],
    );

    useEffect(() => {
        let channel: ReturnType<typeof supabase.channel> | null = null;
        let cancelled = false;

        const initialise = async () => {
            try {
                setLoading(true);
                setMessage("");

                const {
                    data: { user },
                    error,
                } = await supabase.auth.getUser();

                if (error || !user) {
                    await supabase.auth.signOut();
                    router.push("/");
                    return;
                }

                const role = (user.app_metadata?.role ||
                    user.user_metadata?.role ||
                    "member") as UserRole;

                const { data: profile, error: profileError } = await supabase
                    .from("coach_profiles")
                    .select("*")
                    .eq("auth_user_id", user.id)
                    .maybeSingle();

                if (profileError) throw profileError;

                if (cancelled) return;

                const handle = normalizeHandle(profile?.telegram_handle || "");

                setUserRole(role);
                setUserName(user.user_metadata?.name || user.email || "User");
                setCurrentUserId(user.id);
                setTelegramHandle(handle);

                await loadAttendance(handle, user.id);

                channel = supabase
                    .channel(`my-coach-attendance-${user.id}-${selectedMonth}`)
                    .on(
                        "postgres_changes",
                        {
                            event: "*",
                            schema: "public",
                            table: "coach_attendance_votes",
                        },
                        () => loadAttendance(handle, user.id),
                    )
                    .on(
                        "postgres_changes",
                        {
                            event: "*",
                            schema: "public",
                            table: "one_to_one_sessions",
                        },
                        () => loadAttendance(handle, user.id),
                    )
                    .subscribe();
            } catch (err: any) {
                setMessage(err?.message || "Failed to load coaching attendance.");
            } finally {
                setLoading(false);
            }
        };

        initialise();

        return () => {
            cancelled = true;
            if (channel) {
                supabase.removeChannel(channel);
            }
        };
    }, [router, selectedMonth, loadAttendance]);

    const refreshAttendance = async () => {
        try {
            setLoading(true);
            setMessage("");
            await loadAttendance(telegramHandle, currentUserId);
            setMessage("Attendance refreshed.");
        } catch (err: any) {
            setMessage(err?.message || "Failed to refresh attendance.");
        } finally {
            setLoading(false);
        }
    };

    const getDateOnlyKey = (dateKey: string) => {
        const parsed = parseDateKey(dateKey);
        if (!parsed) return dateKey;
        return `${parsed.year}-${parsed.month}-${parsed.day}`;
    };

    const getDateSortValue = (dateKey: string) => {
        const parsed = parseDateKey(dateKey);
        if (!parsed) return Number.MAX_SAFE_INTEGER;
        return new Date(
            Number(parsed.year),
            Number(parsed.month) - 1,
            Number(parsed.day),
        ).getTime();
    };

    const getTimeSortValue = (item: AttendanceItem) => {
        const parsed = parseDateKey(item.dateKey);

        // 1-1 coaching should always appear between the morning and afternoon
        // weekend shifts, even though one_to_one_sessions only stores the date.
        if (item.source === "one_to_one") return 200;

        if (!parsed?.startHourRaw || !parsed?.endHourRaw) {
            const date = getDateSortValue(item.dateKey);
            const day = Number.isFinite(date) ? new Date(date).getDay() : -1;

            // Saturday full-shift polls are treated as 2-6pm.
            return day === 6 ? 400 : 999;
        }

        const startHour = Number(parsed.startHourRaw);
        const endHour = Number(parsed.endHourRaw);
        const shiftKey = `${startHour}-${endHour}`;

        // Fixed weekend display order:
        // 8-12 → 1-1 coaching / 12-1 → 1-5, regardless of poll order.
        const fixedWeekendOrder: Record<string, number> = {
            "8-12": 100,
            "10-12": 150,
            "12-1": 200,
            "1-5": 300,
            "2-6": 400,
        };

        return fixedWeekendOrder[shiftKey] ?? startHour * 10;
    };

    const sortedAttendanceItems = useMemo(() => {
        return [...attendanceItems].sort((a, b) => {
            const dateCompare = getDateSortValue(a.dateKey) - getDateSortValue(b.dateKey);
            if (dateCompare !== 0) return dateCompare;
            return getTimeSortValue(a) - getTimeSortValue(b);
        });
    }, [attendanceItems]);

    const groupedAttendance = useMemo(() => {
        const groups = sortedAttendanceItems.reduce<
            Record<string, { dateKey: string; items: AttendanceItem[] }>
        >((acc, item) => {
            const dateOnlyKey = getDateOnlyKey(item.dateKey);

            if (!acc[dateOnlyKey]) {
                acc[dateOnlyKey] = { dateKey: dateOnlyKey, items: [] };
            }

            acc[dateOnlyKey].items.push(item);
            return acc;
        }, {});

        return Object.values(groups).sort(
            (a, b) => getDateSortValue(a.dateKey) - getDateSortValue(b.dateKey),
        );
    }, [sortedAttendanceItems]);

    const monthlyTotal = useMemo(() => {
        return sortedAttendanceItems.reduce((sum, item) => {
            return sum + getShiftDetails(item.dateKey, item.source).payment;
        }, 0);
    }, [sortedAttendanceItems]);

    if (userRole === null) {
        return (
            <div className="container" style={{ padding: 40 }}>
                Loading...
            </div>
        );
    }

    return (
        <div className="container">
            <AppHeader
                title="My Coaching Attendance"
                userName={userName}
                userRole={userRole}
                mode="dashboard"
            />

            <main style={{ padding: "24px 16px 48px" }}>
                <section
                    className="form-card"
                    style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}
                >
                    <div style={{ textAlign: "center" }}>
                        <h1 style={{ margin: 0 }}>My Coaching Attendance</h1>
                        <p
                            className="muted"
                            style={{ margin: "8px auto 0", maxWidth: 680 }}
                        >
                            Your confirmed coaching shifts and estimated pay appear here.
                            Saturday is automatically treated as 2-6pm. 1-1 sessions assigned
                            to you appear as S$40 sessions.
                        </p>
                    </div>

                    <div
                        style={{
                            maxWidth: 520,
                            margin: "24px auto",
                            display: "grid",
                            gap: 10,
                        }}
                    >
                        <label style={{ fontWeight: 800 }}>Linked Telegram handle</label>
                        <input
                            className="form-input"
                            value={telegramHandle || "Not linked yet"}
                            readOnly
                            disabled
                            style={{
                                background: "#f8fafc",
                                color: telegramHandle ? "#0f172a" : "#94a3b8",
                                cursor: "not-allowed",
                            }}
                        />
                        <p className="muted" style={{ margin: 0 }}>
                            Your Telegram handle is managed in Settings when your account is
                            created. Ask an admin or superuser to update it if this is wrong.
                        </p>
                        {message && (
                            <p className="muted" style={{ margin: 0 }}>
                                {message}
                            </p>
                        )}
                    </div>

                    <section
                        style={{
                            maxWidth: 560,
                            margin: "0 auto 24px",
                            display: "grid",
                            gap: 14,
                        }}
                    >
                        <label
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 9,
                                fontWeight: 800,
                                color: "#0f172a",
                            }}
                        >
              <span style={{ fontSize: "0.95rem", textAlign: "center" }}>
                Month
              </span>

                            <input
                                type="month"
                                className="form-input"
                                value={selectedMonth}
                                onChange={(event) => setSelectedMonth(event.target.value)}
                                style={{
                                    width: "100%",
                                    minHeight: 48,
                                    boxSizing: "border-box",
                                    background: "#ffffff",
                                }}
                            />
                        </label>

                        <button
                            type="button"
                            className="btn share-btn"
                            onClick={refreshAttendance}
                            disabled={loading}
                            style={{
                                width: "100%",
                                minHeight: 44,
                                borderRadius: 12,
                                fontWeight: 900,
                            }}
                        >
                            {loading ? "Refreshing..." : "Refresh Attendance"}
                        </button>

                        <div
                            style={{
                                border: "1px solid #bfdbfe",
                                borderRadius: 14,
                                padding: "18px 16px",
                                background: "#eff6ff",
                                textAlign: "center",
                            }}
                        >
                            <div
                                style={{
                                    color: "#475569",
                                    fontWeight: 800,
                                    fontSize: "0.95rem",
                                }}
                            >
                                Estimated Coaching Pay
                            </div>

                            <div
                                style={{
                                    marginTop: 8,
                                    fontSize: "2rem",
                                    lineHeight: 1.1,
                                    fontWeight: 900,
                                    color: "#1d4ed8",
                                }}
                            >
                                {money(monthlyTotal)}
                            </div>

                            <div
                                style={{
                                    marginTop: 7,
                                    color: "#64748b",
                                    fontSize: "0.9rem",
                                    fontWeight: 700,
                                }}
                            >
                                {sortedAttendanceItems.length} shift
                                {sortedAttendanceItems.length === 1 ? "" : "s"}
                            </div>
                        </div>
                    </section>

                    <div style={{ display: "grid", gap: 16 }}>
                        {groupedAttendance.length === 0 ? (
                            <div
                                style={{ textAlign: "center", padding: 36, color: "#64748b" }}
                            >
                                No coaching attendance has been recorded for this Telegram
                                handle.
                            </div>
                        ) : (
                            groupedAttendance.map((group) => {
                                const firstDetails = getShiftDetails(group.dateKey, "telegram");
                                const dayTotal = group.items.reduce((sum, item) => {
                                    return sum + getShiftDetails(item.dateKey, item.source).payment;
                                }, 0);

                                return (
                                    <article
                                        key={group.dateKey}
                                        style={{
                                            border: "1px solid #dbe4f0",
                                            borderRadius: 14,
                                            padding: 20,
                                            background: "#f8fafc",
                                            textAlign: "center",
                                        }}
                                    >
                                        <h2 style={{ margin: 0 }}>{firstDetails.dateLabel}</h2>

                                        <div
                                            style={{
                                                marginTop: 14,
                                                display: "grid",
                                                gap: 10,
                                            }}
                                        >
                                            {group.items.map((item) => {
                                                const { timeLabel, payment } = getShiftDetails(
                                                    item.dateKey,
                                                    item.source,
                                                );

                                                return (
                                                    <div
                                                        key={item.id}
                                                        style={{
                                                            display: "grid",
                                                            gridTemplateColumns: "1fr auto",
                                                            gap: 12,
                                                            alignItems: "center",
                                                            border: "1px solid #e2e8f0",
                                                            borderRadius: 12,
                                                            background: "#ffffff",
                                                            padding: "12px 14px",
                                                            textAlign: "left",
                                                        }}
                                                    >
                                                        <div>
                                                            <p
                                                                style={{
                                                                    margin: 0,
                                                                    fontSize: "1.02rem",
                                                                    fontWeight: 900,
                                                                    color: "#2563eb",
                                                                }}
                                                            >
                                                                {timeLabel}
                                                            </p>

                                                            <p
                                                                style={{
                                                                    margin: "5px 0 0",
                                                                    color: "#047857",
                                                                    fontWeight: 800,
                                                                }}
                                                            >
                                                                {item.statusLabel}
                                                            </p>
                                                        </div>

                                                        <p
                                                            style={{
                                                                margin: 0,
                                                                fontSize: "1.02rem",
                                                                fontWeight: 900,
                                                                color: "#7c3aed",
                                                                whiteSpace: "nowrap",
                                                            }}
                                                        >
                                                            {payment > 0 ? money(payment) : "Payment unavailable"}
                                                        </p>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        <div
                                            style={{
                                                marginTop: 14,
                                                paddingTop: 12,
                                                borderTop: "1px solid #e2e8f0",
                                                display: "flex",
                                                justifyContent: "center",
                                                gap: 8,
                                                flexWrap: "wrap",
                                                color: "#334155",
                                                fontWeight: 900,
                                            }}
                                        >
                                            <span>{group.items.length} session{group.items.length === 1 ? "" : "s"}</span>
                                            <span>·</span>
                                            <span>Day total: {money(dayTotal)}</span>
                                        </div>
                                    </article>
                                );
                            })
                        )}
                    </div>
                </section>
            </main>
        </div>
    );
}
