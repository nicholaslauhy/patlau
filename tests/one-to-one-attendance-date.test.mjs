import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEarlierOneToOneAttendance } from '../app/lib/one-to-one-attendance-date.ts';

const validSession = {
    sessionDate: '2026-07-21',
    attendanceStatus: 'scheduled',
    removedFromTraining: false,
    removedAt: null,
    studentActive: true,
    todayDateKey: '2026-07-22',
};

test('an active scheduled 1-1 booking strictly before today can be marked', () => {
    assert.equal(validateEarlierOneToOneAttendance(validSession), null);
});

test('today, future dates, and malformed dates cannot be marked as earlier attendance', () => {
    assert.match(
        validateEarlierOneToOneAttendance({ ...validSession, sessionDate: '2026-07-22' }) || '',
        /before today/,
    );
    assert.match(
        validateEarlierOneToOneAttendance({ ...validSession, sessionDate: '2026-07-23' }) || '',
        /future date/,
    );
    assert.match(
        validateEarlierOneToOneAttendance({ ...validSession, sessionDate: 'not-a-date' }) || '',
        /Choose the lesson date/,
    );
});

test('removed lessons, inactive students, and completed attendance are rejected', () => {
    assert.match(
        validateEarlierOneToOneAttendance({ ...validSession, removedFromTraining: true }) || '',
        /removed from training/,
    );
    assert.match(
        validateEarlierOneToOneAttendance({ ...validSession, studentActive: false }) || '',
        /no longer active/,
    );
    assert.match(
        validateEarlierOneToOneAttendance({ ...validSession, attendanceStatus: 'attended' }) || '',
        /already been recorded/,
    );
});

test('legacy null attendance status remains eligible as scheduled', () => {
    assert.equal(
        validateEarlierOneToOneAttendance({ ...validSession, attendanceStatus: null }),
        null,
    );
});

test('legacy scheduled rows with makeup links are rejected instead of orphaning usage', () => {
    assert.match(
        validateEarlierOneToOneAttendance({
            ...validSession,
            makeupTargetType: 'weekend',
        }) || '',
        /makeup information/,
    );
    assert.match(
        validateEarlierOneToOneAttendance({
            ...validSession,
            makeupUsageId: '7f8d5911-2c52-49d5-8258-cdb83715da81',
        }) || '',
        /makeup information/,
    );
});
