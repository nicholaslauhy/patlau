export type WeekendLessonDay = 'Saturday' | 'Sunday';
export type WeekendAttendanceStatus = 'mark' | 'missed' | 'makeup';

const pad = (value: number) => String(value).padStart(2, '0');

export const localDateKey = (date: Date) => (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
);

export const singaporeDateKey = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Singapore',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
};

const parseDateKey = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day);

    if (
        Number.isNaN(parsed.getTime())
        || parsed.getFullYear() !== year
        || parsed.getMonth() !== month - 1
        || parsed.getDate() !== day
    ) {
        return null;
    }

    return parsed;
};

export const attendanceRecordDateKey = (record: unknown) => {
    const raw = String(record || '').trim();
    const firstPart = raw.split('|')[0].replace(/\s+\((missed|makeup)\)$/i, '');
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(firstPart);
    return match?.[1] || null;
};

export const parseWeekendAttendanceRecord = (record: unknown) => {
    const raw = String(record || '');

    if (raw.includes('|')) {
        const [dateIso, statusRaw, originalMissedDate, targetTrainingType, usageId] = raw.split('|');
        const status = statusRaw === 'missed' || statusRaw === 'makeup'
            ? statusRaw as WeekendAttendanceStatus
            : 'mark';
        return { dateIso, status, originalMissedDate, targetTrainingType, usageId };
    }

    const legacyMissedMatch = raw.match(/^(.*)\s+\(missed\)$/i);
    if (legacyMissedMatch) {
        return { dateIso: legacyMissedMatch[1], status: 'missed' as const };
    }

    const legacyMakeupMatch = raw.match(/^(.*)\s+\(makeup\)$/i);
    if (legacyMakeupMatch) {
        return { dateIso: legacyMakeupMatch[1], status: 'makeup' as const };
    }

    return { dateIso: raw, status: 'mark' as const };
};

export const attendanceRecordOccupiedDateKeys = (record: unknown) => {
    const primaryDate = attendanceRecordDateKey(record);
    const parsed = parseWeekendAttendanceRecord(record);
    const originalMissedDate = parsed.status === 'makeup' && parsed.originalMissedDate
        ? attendanceRecordDateKey(parsed.originalMissedDate)
        : null;

    return Array.from(new Set([primaryDate, originalMissedDate].filter(Boolean))) as string[];
};

export const isLessonDateForDay = (dateKey: string, studentDay: string) => {
    const date = parseDateKey(dateKey);
    if (!date) return false;
    if (studentDay === 'Saturday') return date.getDay() === 6;
    if (studentDay === 'Sunday') return date.getDay() === 0;
    return false;
};

export function validateAlternateAttendanceDate({
    dateKey,
    attendanceRecords,
    todayDateKey = singaporeDateKey(),
}: {
    dateKey: string;
    attendanceRecords: unknown[];
    todayDateKey?: string;
}) {
    if (!dateKey || !parseDateKey(dateKey)) return 'Choose the lesson date.';
    if (dateKey > todayDateKey) return 'Attendance cannot be recorded for a future date.';
    if (dateKey === todayDateKey) return 'Choose a date before today.';

    if (attendanceRecords.some((record) => attendanceRecordOccupiedDateKeys(record).includes(dateKey))) {
        return 'Attendance already exists for this date. Review the attendance history before adding another entry.';
    }

    return null;
}

export function validateCurrentWeekendAttendanceDate({
    dateKey,
    studentDay,
    attendanceRecords,
    todayDateKey = singaporeDateKey(),
}: {
    dateKey: string;
    studentDay: string;
    attendanceRecords: unknown[];
    todayDateKey?: string;
}) {
    if (!dateKey || !parseDateKey(dateKey)) return 'Choose the lesson date.';
    if (dateKey !== todayDateKey) return 'Current attendance must be recorded for today.';

    const expectedDay = studentDay === 'Saturday' || studentDay === 'Sunday'
        ? studentDay
        : null;
    if (!expectedDay) return 'This student does not have a valid Weekend lesson day.';
    if (!isLessonDateForDay(dateKey, expectedDay)) {
        return `Today is not this student's scheduled ${expectedDay} lesson day.`;
    }
    if (attendanceRecords.some((record) => attendanceRecordOccupiedDateKeys(record).includes(dateKey))) {
        return 'Attendance already exists for this date. Review the attendance history before adding another entry.';
    }

    return null;
}

export function findLatestAvailableLessonDate({
    attendanceRecords,
    todayDateKey = singaporeDateKey(),
}: {
    attendanceRecords: unknown[];
    todayDateKey?: string;
}) {
    const usedDates = new Set(attendanceRecords.flatMap(attendanceRecordOccupiedDateKeys));
    const candidate = parseDateKey(todayDateKey);
    if (!candidate) return '';
    candidate.setDate(candidate.getDate() - 1);

    for (let offset = 0; offset < 370; offset += 1) {
        const key = localDateKey(candidate);
        if (!usedDates.has(key)) return key;
        candidate.setDate(candidate.getDate() - 1);
    }

    return '';
}
