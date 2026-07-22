export type AttendanceProgramme = 'weekend' | 'weekday' | 'matchplay' | 'one_to_one';
export type ReportAttendanceStatus = 'attended' | 'missed' | 'makeup';
export type DynamicAttendanceRecord = Record<string, unknown>;

export interface SessionAttendanceReportEntry {
    id: string;
    programme: AttendanceProgramme;
    dateKey: string;
    sessionKey: string;
    sessionTitle: string;
    studentKey: string;
    studentName: string;
    status: ReportAttendanceStatus;
    recordedAt: string;
    detail?: string;
}

export interface SessionAttendanceReportSection {
    dateKey: string;
    sessionKey: string;
    sessionTitle: string;
    entries: SessionAttendanceReportEntry[];
}

const text = (record: DynamicAttendanceRecord | undefined, key: string, fallback = '') => {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
    return fallback;
};

const recordId = (record: DynamicAttendanceRecord, fallback = '') => (
    text(record, 'id', text(record, 'student_id', fallback))
);

const dateKey = (rawValue: unknown) => {
    const prefix = String(rawValue || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(prefix) ? prefix : null;
};

const normaliseStatus = (rawValue: unknown): ReportAttendanceStatus | null => {
    switch (String(rawValue || '').trim().toLowerCase()) {
        case 'mark':
        case 'attended':
        case 'present':
            return 'attended';
        case 'missed':
        case 'absent':
            return 'missed';
        case 'makeup':
        case 'make-up':
            return 'makeup';
        default:
            return null;
    }
};

const numberLabel = (value: unknown) => {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return '0';
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1).replace(/\.0$/, '');
};

const displayProgramme = (value: string) => {
    if (value === 'one_to_one') return '1-1';
    if (value === 'matchplay') return 'MatchPlay';
    return value
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const buildLookup = (records: DynamicAttendanceRecord[]) => {
    const lookup = new Map<string, DynamicAttendanceRecord>();

    records.forEach((record) => {
        [recordId(record), text(record, 'student_id'), text(record, 'auth_user_id'), text(record, 'user_id')]
            .filter(Boolean)
            .forEach((key) => lookup.set(key, record));
    });

    return lookup;
};

const coachDisplayName = (record?: DynamicAttendanceRecord) => {
    const metadata = record?.user_metadata;
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
        const name = text(metadata as DynamicAttendanceRecord, 'name');
        if (name) return name;
    }
    return text(record, 'name', text(record, 'email'));
};

const weekendEntries = (students: DynamicAttendanceRecord[]) => students.flatMap((student) => {
    const studentKey = text(student, 'student_id', recordId(student));
    const studentName = text(student, 'student_name', 'Student');
    const day = text(student, 'student_day', 'Weekend');
    const timeslot = text(student, 'student_timeslot', 'Session');
    const sessionTitle = [day, timeslot].filter(Boolean).join(' • ') || 'Weekend session';
    const sessionKey = `${day.toLowerCase()}|${timeslot.toLowerCase()}`;
    const records = Array.isArray(student.attendance_records) ? student.attendance_records : [];

    return records.flatMap((rawRecord, index): SessionAttendanceReportEntry[] => {
        if (typeof rawRecord !== 'string') return [];
        const parts = rawRecord.split('|');
        let recordedAt = parts[0] || rawRecord;
        let rawStatus = parts[1] || 'attended';

        if (!rawRecord.includes('|')) {
            const legacy = rawRecord.match(/^(.*)\s+\((missed|makeup)\)$/i);
            if (legacy) {
                recordedAt = legacy[1];
                rawStatus = legacy[2];
            }
        }

        const attendanceDate = dateKey(recordedAt);
        const status = normaliseStatus(rawStatus);
        if (!attendanceDate || !status) return [];

        const target = parts[3] || '';
        return [{
            id: `weekend|${studentKey}|${index}|${rawRecord}`,
            programme: 'weekend',
            dateKey: attendanceDate,
            sessionKey,
            sessionTitle,
            studentKey,
            studentName,
            status,
            recordedAt,
            detail: status === 'makeup' && target
                ? `Makeup programme: ${displayProgramme(target)}`
                : undefined,
        }];
    });
});

const tableEntries = (
    programme: 'weekday' | 'matchplay',
    students: DynamicAttendanceRecord[],
    attendanceRecords: DynamicAttendanceRecord[],
) => {
    const studentsById = buildLookup(students);
    const studentIdKey = programme === 'weekday' ? 'weekday_student_id' : 'matchplay_student_id';

    return attendanceRecords.flatMap((attendance): SessionAttendanceReportEntry[] => {
        const studentKey = text(attendance, studentIdKey);
        const attendanceDate = dateKey(attendance.attendance_date);
        const status = normaliseStatus(attendance.status);
        if (!studentKey || !attendanceDate || !status) return [];

        const student = studentsById.get(studentKey);
        const studentName = text(student, 'student_name', text(attendance, 'student_name', 'Student'));
        const recordedAt = text(attendance, 'updated_at', text(attendance, 'created_at', attendanceDate));
        const id = recordId(attendance, `${studentKey}|${attendanceDate}`);

        if (programme === 'weekday') {
            const day = text(attendance, 'day_name', 'Weekday');
            const duration = Number(attendance.duration_hours || 0);
            const durationText = numberLabel(duration);
            return [{
                id: `weekday|${id}`,
                programme,
                dateKey: attendanceDate,
                sessionKey: `${day.toLowerCase()}|${durationText}h`,
                sessionTitle: `${day}${duration > 0 ? ` • ${durationText}h` : ''} session`,
                studentKey,
                studentName,
                status,
                recordedAt,
                detail: duration > 0 ? `Duration: ${durationText} hours` : undefined,
            }];
        }

        return [{
            id: `matchplay|${id}`,
            programme,
            dateKey: attendanceDate,
            sessionKey: 'matchplay',
            sessionTitle: 'MatchPlay session',
            studentKey,
            studentName,
            status,
            recordedAt,
        }];
    });
};

const oneToOneEntries = (
    students: DynamicAttendanceRecord[],
    sessions: DynamicAttendanceRecord[],
    coaches: DynamicAttendanceRecord[],
) => {
    const studentsById = buildLookup(students);
    const coachesById = buildLookup(coaches);

    return sessions.flatMap((session): SessionAttendanceReportEntry[] => {
        const status = normaliseStatus(session.attendance_status);
        const attendanceDate = dateKey(session.session_date);
        if (!status || !attendanceDate) return [];

        const studentKey = text(session, 'student_id', recordId(session));
        const coachKey = text(session, 'coach_id');
        const studentName = text(
            session,
            'student_name',
            text(studentsById.get(studentKey), 'student_name', 'Student'),
        );
        const coachName = text(session, 'coach_name', coachDisplayName(coachesById.get(coachKey)));
        const recordedAt = text(
            session,
            'attendance_updated_at',
            text(session, 'updated_at', attendanceDate),
        );

        return [{
            id: `oneToOne|${recordId(session, `${studentKey}|${attendanceDate}`)}`,
            programme: 'one_to_one',
            dateKey: attendanceDate,
            sessionKey: 'one-to-one',
            sessionTitle: '1-1 Training',
            studentKey,
            studentName,
            status,
            recordedAt,
            detail: coachName ? `Coach: ${coachName}` : undefined,
        }];
    });
};

export function buildSessionAttendanceEntries({
    programme,
    students,
    attendanceRecords = [],
    sessions = [],
    coaches = [],
}: {
    programme: AttendanceProgramme;
    students: DynamicAttendanceRecord[];
    attendanceRecords?: DynamicAttendanceRecord[];
    sessions?: DynamicAttendanceRecord[];
    coaches?: DynamicAttendanceRecord[];
}) {
    const rawEntries = programme === 'weekend'
        ? weekendEntries(students)
        : programme === 'weekday' || programme === 'matchplay'
            ? tableEntries(programme, students, attendanceRecords)
            : oneToOneEntries(students, sessions, coaches);

    const latest = new Map<string, SessionAttendanceReportEntry>();
    rawEntries.forEach((entry) => {
        const key = [entry.programme, entry.dateKey, entry.sessionKey, entry.studentKey].join('|');
        const existing = latest.get(key);
        if (!existing || entry.recordedAt >= existing.recordedAt) latest.set(key, entry);
    });

    return [...latest.values()].sort((left, right) => (
        right.dateKey.localeCompare(left.dateKey)
        || left.sessionTitle.localeCompare(right.sessionTitle, undefined, { sensitivity: 'base' })
        || left.studentName.localeCompare(right.studentName, undefined, { sensitivity: 'base' })
    ));
}

export function groupSessionAttendanceEntries(entries: SessionAttendanceReportEntry[]) {
    const grouped = new Map<string, SessionAttendanceReportSection>();

    entries.forEach((entry) => {
        const key = `${entry.dateKey}|${entry.sessionKey}`;
        const group = grouped.get(key);
        if (group) {
            group.entries.push(entry);
        } else {
            grouped.set(key, {
                dateKey: entry.dateKey,
                sessionKey: entry.sessionKey,
                sessionTitle: entry.sessionTitle,
                entries: [entry],
            });
        }
    });

    return [...grouped.values()]
        .map((section) => ({
            ...section,
            entries: [...section.entries].sort((left, right) => (
                left.studentName.localeCompare(right.studentName, undefined, { sensitivity: 'base' })
            )),
        }))
        .sort((left, right) => (
            right.dateKey.localeCompare(left.dateKey)
            || left.sessionTitle.localeCompare(right.sessionTitle, undefined, { sensitivity: 'base' })
        ));
}
