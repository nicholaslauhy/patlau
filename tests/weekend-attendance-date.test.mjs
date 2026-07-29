import assert from 'node:assert/strict';
import test from 'node:test';
import {
    attendanceRecordDateKey,
    attendanceRecordOccupiedDateKeys,
    canUseWeekendAttendanceDate,
    findLatestAvailableLessonDate,
    isLessonDateForDay,
    parseWeekendAttendanceRecord,
    singaporeDateKey,
    validateAlternateAttendanceDate,
    validateCurrentWeekendAttendanceDate,
} from '../app/lib/weekend-attendance-date.ts';

test('only superusers can record Weekend attendance for another date', () => {
    const shared = {
        action: 'mark',
        dateKey: '2026-07-24',
        todayDateKey: '2026-07-25',
    };

    assert.equal(canUseWeekendAttendanceDate({ ...shared, role: 'member' }), false);
    assert.equal(canUseWeekendAttendanceDate({ ...shared, role: 'admin' }), false);
    assert.equal(canUseWeekendAttendanceDate({ ...shared, role: 'superuser' }), true);
    assert.equal(
        canUseWeekendAttendanceDate({
            role: 'member',
            action: 'mark',
            dateKey: '2026-07-25',
            todayDateKey: '2026-07-25',
        }),
        true,
    );
});

test('alternate Weekend attendance accepts any unused date strictly before today', () => {
    assert.equal(isLessonDateForDay('2026-07-25', 'Saturday'), true);
    assert.equal(isLessonDateForDay('2026-07-26', 'Saturday'), false);
    assert.equal(isLessonDateForDay('2026-07-26', 'Sunday'), true);

    assert.equal(
        validateAlternateAttendanceDate({
            dateKey: '2026-07-23',
            attendanceRecords: [],
            todayDateKey: '2026-07-27',
        }),
        null,
    );
    assert.match(
        validateAlternateAttendanceDate({
            dateKey: '2026-07-27',
            attendanceRecords: [],
            todayDateKey: '2026-07-27',
        }) || '',
        /before today/,
    );
});

test('current-day Weekend attendance still requires the scheduled lesson day', () => {
    assert.equal(
        validateCurrentWeekendAttendanceDate({
            dateKey: '2026-07-25',
            studentDay: 'Saturday',
            attendanceRecords: [],
            todayDateKey: '2026-07-25',
        }),
        null,
    );
    assert.match(
        validateCurrentWeekendAttendanceDate({
            dateKey: '2026-07-25',
            studentDay: 'Sunday',
            attendanceRecords: [],
            todayDateKey: '2026-07-25',
        }) || '',
        /scheduled Sunday/,
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
            attendanceRecords: records,
            todayDateKey: '2026-07-25',
        }) || '',
        /future date/,
    );
    assert.match(
        validateAlternateAttendanceDate({
            dateKey: '2026-07-18',
            attendanceRecords: records,
            todayDateKey: '2026-07-25',
        }) || '',
        /already exists/,
    );
});

test('a Weekend makeup reserves both its attendance date and original missed date', () => {
    const makeupRecord = '2026-07-18|makeup|2026-07-11|weekday|usage-123';
    assert.deepEqual(
        attendanceRecordOccupiedDateKeys(makeupRecord),
        ['2026-07-18', '2026-07-11'],
    );
    assert.match(
        validateAlternateAttendanceDate({
            dateKey: '2026-07-11',
            attendanceRecords: [makeupRecord],
            todayDateKey: '2026-07-22',
        }) || '',
        /already exists/,
    );
});

test('the default selection finds the latest unused past date across a year boundary', () => {
    assert.equal(
        findLatestAvailableLessonDate({
            attendanceRecords: ['2027-01-02'],
            todayDateKey: '2027-01-03',
        }),
        '2027-01-01',
    );
    assert.equal(
        findLatestAvailableLessonDate({
            attendanceRecords: [],
            todayDateKey: '2024-03-01',
        }),
        '2024-02-29',
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
