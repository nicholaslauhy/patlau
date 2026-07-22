import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildSessionAttendanceEntries,
    groupSessionAttendanceEntries,
} from '../app/lib/session-attendance-report.ts';

test('Weekend reports parse legacy records and keep the latest result per student and session', () => {
    const entries = buildSessionAttendanceEntries({
        programme: 'weekend',
        students: [{
            student_id: 'student-1',
            student_name: 'Brendan Lau',
            student_day: 'Saturday',
            student_timeslot: '2-4pm',
            attendance_records: [
                '2026-07-20T08:00:00Z|missed',
                '2026-07-20T09:00:00Z|attended',
                '2026-07-21T08:00:00Z|makeup||weekday',
                '2026-07-22T08:00:00Z (missed)',
                '2026-07-23 (makeup)',
                'not-a-date|attended',
            ],
        }],
    });

    assert.equal(entries.length, 4);
    assert.equal(entries.find((entry) => entry.dateKey === '2026-07-20')?.status, 'attended');
    assert.equal(entries.find((entry) => entry.dateKey === '2026-07-21')?.detail, 'Makeup programme: Weekday');
    assert.equal(entries.find((entry) => entry.dateKey === '2026-07-22')?.status, 'missed');
    assert.equal(entries.find((entry) => entry.dateKey === '2026-07-23')?.status, 'makeup');
    assert.equal(entries[0].sessionTitle, 'Saturday • 2-4pm');
});

test('Weekday and MatchPlay reports resolve student names and normalise statuses', () => {
    const students = [{ id: 'student-2', student_name: 'Nicholas Lau' }];
    const weekday = buildSessionAttendanceEntries({
        programme: 'weekday',
        students,
        attendanceRecords: [{
            id: 10,
            weekday_student_id: 'student-2',
            attendance_date: '2026-07-22',
            day_name: 'Wednesday',
            duration_hours: 1.5,
            status: 'present',
            updated_at: '2026-07-22T13:00:00Z',
        }],
    });
    const matchplay = buildSessionAttendanceEntries({
        programme: 'matchplay',
        students,
        attendanceRecords: [{
            id: 11,
            matchplay_student_id: 'student-2',
            attendance_date: '2026-07-22',
            status: 'absent',
            created_at: '2026-07-22T13:05:00Z',
        }],
    });

    assert.deepEqual(
        { name: weekday[0].studentName, status: weekday[0].status, title: weekday[0].sessionTitle },
        { name: 'Nicholas Lau', status: 'attended', title: 'Wednesday • 1.5h session' },
    );
    assert.deepEqual(
        { name: matchplay[0].studentName, status: matchplay[0].status, title: matchplay[0].sessionTitle },
        { name: 'Nicholas Lau', status: 'missed', title: 'MatchPlay session' },
    );
});

test('1-1 reports resolve coach names and exclude scheduled sessions', () => {
    const entries = buildSessionAttendanceEntries({
        programme: 'one_to_one',
        students: [{ id: 'student-3', student_name: 'Brendan Lau' }],
        coaches: [{
            id: 'coach-1',
            email: 'patrick@example.com',
            user_metadata: { name: 'Patrick Lau' },
        }],
        sessions: [
            {
                id: 20,
                student_id: 'student-3',
                coach_id: 'coach-1',
                session_date: '2026-07-26',
                attendance_status: 'makeup',
                attendance_updated_at: '2026-07-26T12:00:00Z',
            },
            {
                id: 21,
                student_id: 'student-3',
                coach_id: 'coach-1',
                session_date: '2026-08-02',
                attendance_status: 'scheduled',
            },
        ],
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].studentName, 'Brendan Lau');
    assert.equal(entries[0].detail, 'Coach: Patrick Lau');
    assert.equal(entries[0].status, 'makeup');
});

test('report grouping orders newest dates first and students alphabetically', () => {
    const entries = buildSessionAttendanceEntries({
        programme: 'matchplay',
        students: [
            { id: 'b', student_name: 'Zoe' },
            { id: 'a', student_name: 'Amy' },
        ],
        attendanceRecords: [
            { id: 1, matchplay_student_id: 'b', attendance_date: '2026-07-20', status: 'attended' },
            { id: 2, matchplay_student_id: 'a', attendance_date: '2026-07-20', status: 'missed' },
            { id: 3, matchplay_student_id: 'a', attendance_date: '2026-07-21', status: 'makeup' },
        ],
    });
    const sections = groupSessionAttendanceEntries(entries);

    assert.equal(sections[0].dateKey, '2026-07-21');
    assert.deepEqual(sections[1].entries.map((entry) => entry.studentName), ['Amy', 'Zoe']);
});
