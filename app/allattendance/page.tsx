"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import AppHeader from "./../components/AppHeader";
import "./../styles.css";
import "./../dashboard/dashboard.css";

type UserRole = "superuser" | "admin" | "member";
type AttendanceSource = "telegram" | "one_to_one";
type AttendanceViewMode = "day" | "all";

interface AppUser {
    id: string;
    email: string;
    user_metadata?: {
        name?: string;
        role?: UserRole;
    };
    app_metadata?: {
        role?: UserRole;
    };
}

interface CoachProfile {
    auth_user_id: string;
    telegram_handle: string | null;
}

interface AttendanceVote {
    id: number;
    poll_id: string;
    date_key: string;
    telegram_handle: string | null;
    display_name: string | null;
    response: string;
    updated_at: string;
    telegram_user_id?: string | null;
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

interface AttendancePerson {
    id: string;
    name: string;
    email?: string;
    role?: UserRole;
    telegramHandle?: string;
    linked: boolean;
}

interface AttendanceItem {
    id: string;
    source: AttendanceSource;
    personId: string;
    dateKey: string;
    updatedAt: string;
    statusLabel: string;
}

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const normalizeHandle = (value: string | null | undefined) => {
    const trimmed = String(value || "").trim().toLowerCase();
    if (!trimmed) return "";
    return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
};

const normalizeDateKey = (dateValue: string) => dateValue.slice(0, 10);

const formatDateLocal = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

const getNextDateKey = (dateKey: string) => {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + 1);
    return formatDateLocal(date);
};

const getDisplayName = (user: AppUser) => {
    return user.user_metadata?.name || user.email || "User";
};

const getUserRole = (user: any): UserRole => {
    return (user?.app_metadata?.role || user?.user_metadata?.role || "member") as UserRole;
};

const parseDateKey = (dateKey: string) => {
    const cleanKey = dateKey.trim();

    const isoMatch = cleanKey.match(
        /^(\d{4})-(\d{2})-(\d{2})(?:-(\d{1,2})-(\d{1,2}))?$/,
    );

    if (isoMatch) {
        const [, year, month, day, startHourRaw, endHourRaw] = isoMatch;
        return { year, month, day, startHourRaw, endHourRaw };
    }

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
            dateOnlyKey: dateKey,
        };
    }

    const { year, month, day, startHourRaw, endHourRaw } = parsed;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    const dayOfWeek = date.getDay();
    const dateOnlyKey = `${year}-${month}-${day}`;

    const dateLabel = date.toLocaleDateString("en-SG", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    });

    if (source === "one_to_one") {
        return {
            dateLabel,
            timeLabel: "1-1 session",
            payment: 40,
            dateOnlyKey,
        };
    }

    if (!startHourRaw || !endHourRaw) {
        if (dayOfWeek === 6) {
            return {
                dateLabel,
                timeLabel: "2-6pm",
                payment: 70,
                dateOnlyKey,
            };
        }

        return {
            dateLabel,
            timeLabel: "Timing unavailable",
            payment: 0,
            dateOnlyKey,
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
        dateOnlyKey,
    };
};

const getTimeSortValue = (item: Pick<AttendanceItem, "dateKey" | "source">) => {
    const parsed = parseDateKey(item.dateKey);

    // 1-1 coaching should appear between morning and afternoon shifts.
    if (item.source === "one_to_one") return 200;

    if (!parsed?.startHourRaw || !parsed?.endHourRaw) {
        const date = getDateSortValue(item.dateKey);
        const day = Number.isFinite(date) ? new Date(date).getDay() : -1;
        return day === 6 ? 400 : 999;
    }

    const startHour = Number(parsed.startHourRaw);
    const endHour = Number(parsed.endHourRaw);
    const shiftKey = `${startHour}-${endHour}`;

    // Fixed weekend display order, regardless of poll order.
    const fixedWeekendOrder: Record<string, number> = {
        "8-12": 100,
        "10-12": 150,
        "12-1": 200,
        "1-5": 300,
        "2-6": 400,
    };

    return fixedWeekendOrder[shiftKey] ?? startHour * 10;
};

const money = (value: number) => `S$${Number(value || 0).toFixed(2)}`;

export default function AllAttendancePage() {
    const router = useRouter();
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [userName, setUserName] = useState("");
    const [peopleById, setPeopleById] = useState<Record<string, AttendancePerson>>({});
    const [attendanceItems, setAttendanceItems] = useState<AttendanceItem[]>([]);
    const [selectedDate, setSelectedDate] = useState(() => formatDateLocal(new Date()));
    const [viewMode, setViewMode] = useState<AttendanceViewMode>("day");
    const [searchTerm, setSearchTerm] = useState("");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");

    const loadAllAttendance = useCallback(async () => {
        try {
            setLoading(true);
            setMessage("");

            const nextDateKey = getNextDateKey(selectedDate);
            const isAllRecordsView = viewMode === "all";

            const usersPromise = fetch("/api/users/list", {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            }).then(async (res) => {
                if (!res.ok) throw new Error("Failed to load users.");
                const json = await res.json();
                return (json.users || []) as AppUser[];
            });

            const profilesPromise = supabase
                .from("coach_profiles")
                .select("auth_user_id, telegram_handle");

            const votesPromise = supabase
                .from("coach_attendance_votes")
                .select("id, poll_id, date_key, telegram_handle, display_name, response, updated_at, telegram_user_id")
                .eq("response", "yes")
                .order("updated_at", { ascending: true });

            let oneToOneQuery = supabase
                .from("one_to_one_sessions")
                .select(
                    "id, session_date, student_id, coach_id, removed_from_training, removed_at, payment_exempt, payment_exempt_at, attendance_status, updated_at",
                )
                .or("removed_from_training.is.null,removed_from_training.eq.false")
                .order("session_date", { ascending: true })
                .order("id", { ascending: true });

            if (!isAllRecordsView) {
                oneToOneQuery = oneToOneQuery
                    .gte("session_date", selectedDate)
                    .lt("session_date", nextDateKey);
            }

            const oneToOnePromise = oneToOneQuery;

            const [users, profilesResult, votesResult, oneToOneResult] = await Promise.all([
                usersPromise,
                profilesPromise,
                votesPromise,
                oneToOnePromise,
            ]);

            if (profilesResult.error) throw profilesResult.error;
            if (votesResult.error) throw votesResult.error;
            if (oneToOneResult.error) throw oneToOneResult.error;

            const usersById = new Map<string, AppUser>();
            users.forEach((user) => usersById.set(user.id, user));

            const profiles = (profilesResult.data || []) as CoachProfile[];
            const handleToUserId = new Map<string, string>();
            const nextPeopleById: Record<string, AttendancePerson> = {};

            profiles.forEach((profile) => {
                const user = usersById.get(profile.auth_user_id);
                const normalizedHandle = normalizeHandle(profile.telegram_handle);

                if (normalizedHandle) {
                    handleToUserId.set(normalizedHandle, profile.auth_user_id);
                }

                if (user || normalizedHandle) {
                    nextPeopleById[profile.auth_user_id] = {
                        id: profile.auth_user_id,
                        name: user ? getDisplayName(user) : normalizedHandle || "Unknown coach",
                        email: user?.email,
                        role: user ? getUserRole(user) : undefined,
                        telegramHandle: normalizedHandle || undefined,
                        linked: true,
                    };
                }
            });

            users.forEach((user) => {
                if (!nextPeopleById[user.id]) {
                    nextPeopleById[user.id] = {
                        id: user.id,
                        name: getDisplayName(user),
                        email: user.email,
                        role: getUserRole(user),
                        telegramHandle: undefined,
                        linked: true,
                    };
                }
            });

            const telegramItems = ((votesResult.data || []) as AttendanceVote[])
                .filter((vote) => isAllRecordsView || getDateOnlyKey(vote.date_key) === selectedDate)
                .map((vote) => {
                    const normalizedHandle = normalizeHandle(vote.telegram_handle || vote.display_name || "");
                    const matchedUserId = normalizedHandle ? handleToUserId.get(normalizedHandle) : undefined;
                    const fallbackId = `telegram:${normalizedHandle || vote.telegram_user_id || vote.id}`;
                    const personId = matchedUserId || fallbackId;

                    if (!nextPeopleById[personId]) {
                        nextPeopleById[personId] = {
                            id: personId,
                            name: normalizedHandle || vote.display_name || "Unlinked Telegram user",
                            telegramHandle: normalizedHandle || undefined,
                            linked: false,
                        };
                    }

                    return {
                        id: `telegram-${vote.id}`,
                        source: "telegram" as AttendanceSource,
                        personId,
                        dateKey: vote.date_key,
                        updatedAt: vote.updated_at,
                        statusLabel: "Attending",
                    };
                });

            const oneToOneItems = ((oneToOneResult.data || []) as OneToOneSession[]).map((session) => {
                if (!nextPeopleById[session.coach_id]) {
                    nextPeopleById[session.coach_id] = {
                        id: session.coach_id,
                        name: "Unassigned coach",
                        linked: false,
                    };
                }

                return {
                    id: `one-to-one-${session.id}`,
                    source: "one_to_one" as AttendanceSource,
                    personId: session.coach_id,
                    dateKey: normalizeDateKey(session.session_date),
                    updatedAt: session.updated_at || session.session_date,
                    statusLabel: "1-1 Coaching",
                };
            });

            setPeopleById(nextPeopleById);
            setAttendanceItems([...telegramItems, ...oneToOneItems]);
            setMessage("All attendance refreshed.");
        } catch (err: any) {
            setMessage(err?.message || "Failed to load all attendance.");
        } finally {
            setLoading(false);
        }
    }, [selectedDate, viewMode]);

    useEffect(() => {
        const checkAuth = async () => {
            try {
                setLoading(true);
                const {
                    data: { user },
                    error,
                } = await supabase.auth.getUser();

                if (error || !user) {
                    await supabase.auth.signOut();
                    router.push("/");
                    return;
                }

                const role = getUserRole(user);
                setUserRole(role);
                setUserName(user.user_metadata?.name || user.email || "User");

                if (role === "superuser") {
                    await loadAllAttendance();
                }
            } catch (err: any) {
                setMessage(err?.message || "Failed to verify access.");
            } finally {
                setLoading(false);
            }
        };

        checkAuth();
    }, [router, loadAllAttendance]);

    const sortedItems = useMemo(() => {
        return [...attendanceItems].sort((a, b) => {
            const dateCompare = getDateSortValue(a.dateKey) - getDateSortValue(b.dateKey);
            if (dateCompare !== 0) return dateCompare;

            const timeCompare = getTimeSortValue(a) - getTimeSortValue(b);
            if (timeCompare !== 0) return timeCompare;

            return (peopleById[a.personId]?.name || "").localeCompare(
                peopleById[b.personId]?.name || "",
            );
        });
    }, [attendanceItems, peopleById]);

    const filteredItems = useMemo(() => {
        const search = searchTerm.trim().toLowerCase();

        if (!search) return sortedItems;

        return sortedItems.filter((item) => {
            const person = peopleById[item.personId];

            return (
                String(person?.name || "").toLowerCase().includes(search) ||
                String(person?.email || "").toLowerCase().includes(search) ||
                String(person?.telegramHandle || "").toLowerCase().includes(search)
            );
        });
    }, [sortedItems, peopleById, searchTerm]);

    const dayGroups = useMemo(() => {
        const groups = filteredItems.reduce<
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
    }, [filteredItems]);

    const overallTotal = useMemo(() => {
        return filteredItems.reduce((sum, item) => {
            return sum + getShiftDetails(item.dateKey, item.source).payment;
        }, 0);
    }, [filteredItems]);

    const selectedDateLabel = useMemo(() => {
        const [year, month, day] = selectedDate.split("-").map(Number);
        return new Date(year, month - 1, day).toLocaleDateString("en-SG", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
        });
    }, [selectedDate]);

    const viewLabel = viewMode === "all" ? "All records" : selectedDateLabel;

    if (userRole === null) {
        return <div className="container" style={{ padding: 40 }}>Loading...</div>;
    }

    if (userRole !== "superuser") {
        return (
            <div className="container" style={{ padding: "3rem 1rem" }}>
                <div className="form-card" style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
                    <h1 style={{ color: "#dc2626", fontSize: "3rem", marginBottom: "0.5rem" }}>403</h1>
                    <h2 style={{ marginTop: 0 }}>Forbidden</h2>
                    <p style={{ color: "#6b7280", marginBottom: "1.5rem" }}>
                        Only superusers can view all coaches&apos; attendance.
                    </p>
                    <Link href="/dashboard" className="btn share-btn">
                        Return to Dashboard
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <AppHeader
                title="All Coaching Attendance"
                userName={userName}
                userRole={userRole}
                mode="dashboard"
            />

            <main style={{ padding: "24px 16px 48px" }}>
                <section
                    className="form-card"
                    style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}
                >
                    <div style={{ textAlign: "center" }}>
                        <h1 style={{ margin: 0 }}>All Coaching Attendance</h1>
                        <p className="muted" style={{ margin: "8px auto 0", maxWidth: 760 }}>
                            Superuser view of all coaching attendance and 1-1 coaching sessions.
                            View one calendar day or all records. Search still works by name, email, or Telegram handle, but only coach names are shown.
                        </p>
                    </div>

                    <section
                        style={{
                            maxWidth: 760,
                            margin: "24px auto",
                            display: "grid",
                            gap: 14,
                        }}
                    >
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                                gap: 12,
                                alignItems: "end",
                            }}
                        >
                            <label style={{ display: "grid", gap: 8, fontWeight: 800, color: "#0f172a" }}>
                                View
                                <select
                                    className="form-input"
                                    value={viewMode}
                                    onChange={(event) => setViewMode(event.target.value as AttendanceViewMode)}
                                    style={{ minHeight: 48, boxSizing: "border-box", background: "#ffffff" }}
                                >
                                    <option value="day">One calendar day</option>
                                    <option value="all">All records</option>
                                </select>
                            </label>

                            <label style={{ display: "grid", gap: 8, fontWeight: 800, color: "#0f172a" }}>
                                Calendar Day
                                <input
                                    type="date"
                                    className="form-input"
                                    value={selectedDate}
                                    onChange={(event) => setSelectedDate(event.target.value)}
                                    disabled={viewMode === "all"}
                                    style={{
                                        minHeight: 48,
                                        boxSizing: "border-box",
                                        background: viewMode === "all" ? "#f8fafc" : "#ffffff",
                                        color: viewMode === "all" ? "#94a3b8" : "#0f172a",
                                    }}
                                />
                            </label>
                        </div>

                        <label
                            style={{
                                display: "grid",
                                gap: 8,
                                fontWeight: 800,
                                color: "#0f172a",
                                width: "100%",
                                maxWidth: 460,
                                margin: "0 auto",
                                textAlign: "center",
                            }}
                        >
                            Search
                            <input
                                className="form-input"
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                placeholder="Search by name"
                                style={{
                                    minHeight: 48,
                                    boxSizing: "border-box",
                                    background: "#ffffff",
                                    textAlign: "center",
                                }}
                            />
                        </label>

                        <button
                            type="button"
                            className="btn share-btn"
                            onClick={loadAllAttendance}
                            disabled={loading}
                            style={{ width: "100%", minHeight: 44, borderRadius: 12, fontWeight: 900 }}
                        >
                            {loading ? "Refreshing..." : "Refresh All Attendance"}
                        </button>

                        {message && <p className="muted" style={{ textAlign: "center", margin: 0 }}>{message}</p>}

                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                                gap: 12,
                            }}
                        >
                            <div
                                style={{
                                    border: "1px solid #bfdbfe",
                                    borderRadius: 14,
                                    padding: "18px 16px",
                                    background: "#eff6ff",
                                    textAlign: "center",
                                }}
                            >
                                <div style={{ color: "#475569", fontWeight: 800, fontSize: "0.95rem" }}>
                                    Total Estimated Pay
                                </div>
                                <div style={{ marginTop: 8, fontSize: "2rem", lineHeight: 1.1, fontWeight: 900, color: "#1d4ed8" }}>
                                    {money(overallTotal)}
                                </div>
                                <div style={{ marginTop: 7, color: "#64748b", fontSize: "0.9rem", fontWeight: 700 }}>
                                    {viewLabel}
                                </div>
                            </div>

                            <div
                                style={{
                                    border: "1px solid #bbf7d0",
                                    borderRadius: 14,
                                    padding: "18px 16px",
                                    background: "#f0fdf4",
                                    textAlign: "center",
                                }}
                            >
                                <div style={{ color: "#475569", fontWeight: 800, fontSize: "0.95rem" }}>
                                    Total Shifts
                                </div>
                                <div style={{ marginTop: 8, fontSize: "2rem", lineHeight: 1.1, fontWeight: 900, color: "#047857" }}>
                                    {filteredItems.length}
                                </div>
                                <div style={{ marginTop: 7, color: "#64748b", fontSize: "0.9rem", fontWeight: 700 }}>
                                    After search filter
                                </div>
                            </div>
                        </div>
                    </section>

                    <div style={{ display: "grid", gap: 18 }}>
                        {dayGroups.length === 0 ? (
                            <div style={{ textAlign: "center", padding: 36, color: "#64748b" }}>
                                No coaching attendance found for {viewLabel}.
                            </div>
                        ) : (
                            dayGroups.map((dayGroup) => {
                                const dateDetails = getShiftDetails(dayGroup.dateKey, "telegram");
                                const sortedDayItems = [...dayGroup.items].sort((a, b) => {
                                    const timeCompare = getTimeSortValue(a) - getTimeSortValue(b);
                                    if (timeCompare !== 0) return timeCompare;
                                    return (peopleById[a.personId]?.name || "").localeCompare(
                                        peopleById[b.personId]?.name || "",
                                    );
                                });
                                const dayTotal = sortedDayItems.reduce((sum, item) => {
                                    return sum + getShiftDetails(item.dateKey, item.source).payment;
                                }, 0);

                                const timeGroups = sortedDayItems.reduce<
                                    Record<string, { order: number; label: string; items: AttendanceItem[] }>
                                >((acc, item) => {
                                    const details = getShiftDetails(item.dateKey, item.source);
                                    const order = getTimeSortValue(item);
                                    const key = `${order}-${details.timeLabel}`;

                                    if (!acc[key]) {
                                        acc[key] = { order, label: details.timeLabel, items: [] };
                                    }

                                    acc[key].items.push(item);
                                    return acc;
                                }, {});

                                const sortedTimeGroups = Object.values(timeGroups).sort((a, b) => a.order - b.order);

                                return (
                                    <article
                                        key={dayGroup.dateKey}
                                        style={{
                                            border: "1px solid #dbe4f0",
                                            borderRadius: 16,
                                            padding: 20,
                                            background: "#f8fafc",
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                gap: 12,
                                                flexWrap: "wrap",
                                                alignItems: "flex-start",
                                                borderBottom: "1px solid #e2e8f0",
                                                paddingBottom: 14,
                                                marginBottom: 14,
                                            }}
                                        >
                                            <div>
                                                <h2 style={{ margin: 0, color: "#0f172a" }}>{dateDetails.dateLabel}</h2>
                                                <p className="muted" style={{ margin: "5px 0 0" }}>
                                                    Attendance grouped by session timing.
                                                </p>
                                            </div>

                                            <div style={{ textAlign: "right", fontWeight: 900, color: "#7c3aed" }}>
                                                <div>Day total: {money(dayTotal)}</div>
                                                <div style={{ marginTop: 4, color: "#64748b", fontSize: "0.85rem" }}>
                                                    {sortedDayItems.length} shift{sortedDayItems.length === 1 ? "" : "s"}
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ display: "grid", gap: 14 }}>
                                            {sortedTimeGroups.map((timeGroup) => {
                                                const timeTotal = timeGroup.items.reduce((sum, item) => {
                                                    return sum + getShiftDetails(item.dateKey, item.source).payment;
                                                }, 0);

                                                return (
                                                    <section
                                                        key={`${dayGroup.dateKey}-${timeGroup.order}-${timeGroup.label}`}
                                                        style={{
                                                            border: "1px solid #e2e8f0",
                                                            borderRadius: 14,
                                                            background: "#ffffff",
                                                            padding: 14,
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                display: "flex",
                                                                justifyContent: "space-between",
                                                                gap: 10,
                                                                flexWrap: "wrap",
                                                                alignItems: "center",
                                                                marginBottom: 10,
                                                            }}
                                                        >
                                                            <h3 style={{ margin: 0, color: "#2563eb" }}>{timeGroup.label}</h3>
                                                            <strong style={{ color: "#7c3aed" }}>
                                                                {timeGroup.items.length} coach{timeGroup.items.length === 1 ? "" : "es"} · {money(timeTotal)}
                                                            </strong>
                                                        </div>

                                                        <div style={{ display: "grid", gap: 8 }}>
                                                            {timeGroup.items.map((item) => {
                                                                const person = peopleById[item.personId] || {
                                                                    id: item.personId,
                                                                    name: "Unknown coach",
                                                                    linked: false,
                                                                };
                                                                const details = getShiftDetails(item.dateKey, item.source);

                                                                return (
                                                                    <div
                                                                        key={item.id}
                                                                        style={{
                                                                            display: "grid",
                                                                            gridTemplateColumns: "minmax(0, 1fr) auto",
                                                                            gap: 12,
                                                                            alignItems: "center",
                                                                            border: "1px solid #eef2f7",
                                                                            borderRadius: 12,
                                                                            background: "#f8fafc",
                                                                            padding: "10px 12px",
                                                                        }}
                                                                    >
                                                                        <div style={{ minWidth: 0 }}>
                                                                            <p style={{ margin: 0, color: "#111827", fontWeight: 900 }}>
                                                                                {person.name}
                                                                            </p>
                                                                            <p style={{ margin: "4px 0 0", color: "#047857", fontWeight: 800 }}>
                                                                                {item.statusLabel}
                                                                            </p>
                                                                        </div>

                                                                        <p style={{ margin: 0, color: "#7c3aed", fontWeight: 900, whiteSpace: "nowrap" }}>
                                                                            {details.payment > 0 ? money(details.payment) : "Payment unavailable"}
                                                                        </p>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </section>
                                                );
                                            })}
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
