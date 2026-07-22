import assert from 'node:assert/strict';
import test from 'node:test';
import { programmeAttendanceUsedDateKeys } from '../app/lib/programme-attendance-backdate.ts';
import { validateAlternateAttendanceDate } from '../app/lib/weekend-attendance-date.ts';

test('programme backdating reserves attendance and original missed dates', () => {
    const occupiedDates = programmeAttendanceUsedDateKeys([
        {
            attendance_date: '2026-07-18T00:00:00.000Z',
            original_missed_date: '2026-07-12',
        },
        { attendance_date: '2026-07-10' },
    ]);

    assert.deepEqual(occupiedDates, ['2026-07-18', '2026-07-12', '2026-07-10']);
    assert.match(
        validateAlternateAttendanceDate({
            dateKey: '2026-07-12',
            attendanceRecords: occupiedDates,
            todayDateKey: '2026-07-22',
        }) || '',
        /already exists/,
    );
});

test('programme backdating accepts any unused weekday strictly before today', () => {
    assert.equal(
        validateAlternateAttendanceDate({
            dateKey: '2026-07-21',
            attendanceRecords: ['2026-07-20'],
            todayDateKey: '2026-07-22',
        }),
        null,
    );
    assert.match(
        validateAlternateAttendanceDate({
            dateKey: '2026-07-22',
            attendanceRecords: [],
            todayDateKey: '2026-07-22',
        }) || '',
        /before today/,
    );
});
