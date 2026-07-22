import { validateAlternateAttendanceDate } from './weekend-attendance-date';

export function validateEarlierOneToOneAttendance({
    sessionDate,
    attendanceStatus,
    makeupTargetType,
    makeupUsageId,
    removedFromTraining,
    removedAt,
    studentActive,
    todayDateKey,
}: {
    sessionDate: string;
    attendanceStatus: unknown;
    makeupTargetType?: unknown;
    makeupUsageId?: unknown;
    removedFromTraining: unknown;
    removedAt: unknown;
    studentActive: boolean;
    todayDateKey?: string;
}) {
    if (removedFromTraining === true || Boolean(removedAt)) {
        return 'This 1-1 lesson has been removed from training.';
    }

    if (!studentActive) {
        return 'This 1-1 student is no longer active.';
    }

    if (attendanceStatus !== null && attendanceStatus !== undefined && attendanceStatus !== 'scheduled') {
        return 'Attendance has already been recorded for this 1-1 lesson.';
    }

    if (makeupTargetType !== null && makeupTargetType !== undefined) {
        return 'This 1-1 lesson still has makeup information. Undo or resolve the makeup first.';
    }

    if (makeupUsageId !== null && makeupUsageId !== undefined) {
        return 'This 1-1 lesson still has makeup information. Undo or resolve the makeup first.';
    }

    return validateAlternateAttendanceDate({
        dateKey: sessionDate,
        attendanceRecords: [],
        todayDateKey,
    });
}
