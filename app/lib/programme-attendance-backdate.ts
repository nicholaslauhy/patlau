export function programmeAttendanceUsedDateKeys(
    rows: Array<Record<string, unknown>>,
) {
    return rows.flatMap((row) => [
        typeof row.attendance_date === 'string' ? row.attendance_date.slice(0, 10) : '',
        typeof row.original_missed_date === 'string' ? row.original_missed_date.slice(0, 10) : '',
    ]).filter(Boolean);
}
