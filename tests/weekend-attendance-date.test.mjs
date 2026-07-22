import assert from 'node:assert/strict';
import test from 'node:test';
import {
    attendanceRecordDateKey,
    findLatestAvailableLessonDate,
    isLessonDateForDay,
    parseWeekendAttendanceRecord,
    singaporeDateKey,
    validateAlternateAttendanceDate,
} from '../app/lib/weekend-attendance-date.ts';

test('alternate Weekend attendance only accepts the student scheduled day', () => {
    assert.equal(isLessonDateForDay('2026-07-25', 'Saturday'), true);
    assert.equal(isLessonDateForDay('2026-07-26', 'Saturday'), false);
    assert.equal(isLessonDateForDay('2026-07-26', 'Sunday'), true);

    assert.match(
        validateAlternateAttendanceDate({
            dateKey: '2026-07-26',
            studentDay: 'Saturday',
            attendanceRecords: [],
            todayDateKey: '2026-07-27',
        }) || '',
        /Choose a Saturday/,
    );
});

test('future and duplicate lesson dates are rejected across record formats', () => {
    const records = [
        '2026-07-11T08:00:00.000Z',
        '2026-07-18T08:00:00.000Z|missed',
        '2026-07-04 (makeup)',
    ];

    assert.equal(attendanceRecordDateKey(records[0]), '2026-07-11');
    assert.equal(attendanceRecordDateKey(records[1]), '2026-07-18');
    assert.equal(attendanceRecordDateKey(records[2]), '2026-07-04');

    assert.match(
        validateAlternateAttendanceDate({
            dateKey: '2026-08-01',
            studentDay: 'Saturday',
            attendanceRecords: records,
            todayDateKey: '2026-07-25',
        }) || '',
        /future date/,
    );
    assert.match(
        validateAlternateAttendanceDate({
            dateKey: '2026-07-18',
            studentDay: 'Saturday',
            attendanceRecords: records,
            todayDateKey: '2026-07-25',
        }) || '',
        /already exists/,
    );
});

test('the default selection finds the latest unused lesson across a year boundary', () => {
    assert.equal(
        findLatestAvailableLessonDate({
            studentDay: 'Saturday',
            attendanceRecords: ['2027-01-02'],
            todayDateKey: '2027-01-03',
        }),
        '2026-12-26',
    );
    assert.equal(
        findLatestAvailableLessonDate({
            studentDay: 'Sunday',
            attendanceRecords: [],
            todayDateKey: '2024-03-01',
        }),
        '2024-02-25',
    );
});

test('Singapore date keys are stable around the UTC day boundary', () => {
    assert.equal(singaporeDateKey(new Date('2026-07-24T16:30:00.000Z')), '2026-07-25');
    assert.equal(singaporeDateKey(new Date('2026-07-25T15:59:59.000Z')), '2026-07-25');
});

test('Weekend undo parsing preserves current and legacy attendance metadata', () => {
    assert.deepEqual(
        parseWeekendAttendanceRecord('2026-07-18|makeup|2026-07-11|weekday|usage-123'),
        {
            dateIso: '2026-07-18',
            status: 'makeup',
            originalMissedDate: '2026-07-11',
            targetTrainingType: 'weekday',
            usageId: 'usage-123',
        },
    );
    assert.deepEqual(
        parseWeekendAttendanceRecord('2026-07-12 (missed)'),
        { dateIso: '2026-07-12', status: 'missed' },
    );
});
