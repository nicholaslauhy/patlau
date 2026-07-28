type ParentActivityMessage = {
    sender_type?: unknown;
    created_at?: unknown;
};

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

function validTimestamp(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function relativeUnit(value: number, unit: string) {
    return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

/**
 * Return the newest valid parent-message timestamp regardless of the order in
 * which messages were supplied. Outbound AI, Coach Patrick and system rows
 * must never be presented as parent activity.
 */
export function latestParentMessageAt(
    messages: readonly ParentActivityMessage[],
) {
    let latestTimestamp: number | null = null;

    for (const message of messages) {
        if (message.sender_type !== "parent") continue;
        const timestamp = validTimestamp(message.created_at);
        if (
            timestamp !== null
            && (latestTimestamp === null || timestamp > latestTimestamp)
        ) {
            latestTimestamp = timestamp;
        }
    }

    return latestTimestamp === null
        ? null
        : new Date(latestTimestamp).toISOString();
}

/**
 * Describe the latest message received from a parent. This is intentionally
 * message activity, not an online, last-seen or typing claim: Telegram's Bot
 * API does not expose those presence signals.
 */
export function formatParentMessageActivity(
    lastParentMessageAt: string | null | undefined,
    now: number | Date = Date.now(),
) {
    const activityTimestamp = validTimestamp(lastParentMessageAt);
    const nowTimestamp = now instanceof Date ? now.getTime() : Number(now);
    if (activityTimestamp === null || !Number.isFinite(nowTimestamp)) {
        return "No parent message recorded yet";
    }

    // Treat small client/server clock differences as a message received now.
    const elapsed = Math.max(0, nowTimestamp - activityTimestamp);
    if (elapsed < MINUTE_MS) return "Last parent message just now";
    if (elapsed < HOUR_MS) {
        return `Last parent message ${relativeUnit(
            Math.floor(elapsed / MINUTE_MS),
            "minute",
        )}`;
    }
    if (elapsed < DAY_MS) {
        return `Last parent message ${relativeUnit(
            Math.floor(elapsed / HOUR_MS),
            "hour",
        )}`;
    }
    if (elapsed < MONTH_MS) {
        return `Last parent message ${relativeUnit(
            Math.floor(elapsed / DAY_MS),
            "day",
        )}`;
    }
    if (elapsed < YEAR_MS) {
        return `Last parent message ${relativeUnit(
            Math.floor(elapsed / MONTH_MS),
            "month",
        )}`;
    }
    return `Last parent message ${relativeUnit(
        Math.floor(elapsed / YEAR_MS),
        "year",
    )}`;
}
