import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
    getOptionalAuditActor,
    safeAuditError,
    writeAuditEvent,
} from '../../../lib/audit-server';
import {
    attendanceRecordDateKey,
    canUseWeekendAttendanceDate,
    parseWeekendAttendanceRecord,
    singaporeDateKey,
    validateAlternateAttendanceDate,
    validateCurrentWeekendAttendanceDate,
} from '../../../lib/weekend-attendance-date';

const ALLOWED_ROLES = new Set(['member', 'admin', 'superuser']);
const ALLOWED_ACTIONS = new Set(['mark', 'missed', 'undo']);

type WeekendAttendanceAction = 'mark' | 'missed' | 'undo';

const eventDetails = (action: WeekendAttendanceAction, attendanceDate: string) => {
    if (action === 'missed') {
        return {
            eventType: 'attendance.weekend.missed',
            auditAction: 'mark_missed',
            failureSummary: 'Failed to mark a Weekend lesson as missed.',
        };
    }

    if (action === 'undo') {
        return {
            eventType: 'attendance.weekend.undo',
            auditAction: 'undo_attendance',
            failureSummary: 'Failed to undo Weekend attendance.',
        };
    }

    const isAlternateDate = Boolean(attendanceDate) && attendanceDate !== singaporeDateKey();
    return {
        eventType: isAlternateDate
            ? 'attendance.weekend.backdated'
            : 'attendance.weekend.mark',
        auditAction: isAlternateDate ? 'mark_attendance_for_date' : 'mark_attendance',
        failureSummary: 'Failed to record Weekend attendance.',
    };
};

export async function POST(request: NextRequest) {
    let caller: Awaited<ReturnType<typeof getOptionalAuditActor>> = null;
    let studentId = '';
    let attendanceDate = '';
    let expectedLastRecord: string | null | undefined;
    let requestedAction: WeekendAttendanceAction = 'mark';
    let details = eventDetails(requestedAction, attendanceDate);

    try {
        caller = await getOptionalAuditActor(request);
        if (!caller) {
            await writeAuditEvent({
                request,
                actor: null,
                eventKind: 'security',
                category: 'attendance',
                eventType: details.eventType,
                action: details.auditAction,
                outcome: 'denied',
                summary: 'An unauthorized Weekend attendance request was denied.',
                actorSource: 'anonymous',
                targetTable: 'students',
            });
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!caller.role || !ALLOWED_ROLES.has(caller.role)) {
            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'attendance',
                eventType: details.eventType,
                action: details.auditAction,
                outcome: 'denied',
                summary: 'A user without permission attempted to change Weekend attendance.',
                targetTable: 'students',
                metadata: { reason: 'insufficient_role' },
            });
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        studentId = typeof body.student_id === 'string' ? body.student_id.trim() : '';
        const actionValue = typeof body.action === 'string' ? body.action.trim() : 'mark';
        requestedAction = ALLOWED_ACTIONS.has(actionValue)
            ? actionValue as WeekendAttendanceAction
            : 'mark';
        attendanceDate = requestedAction === 'missed'
            ? singaporeDateKey()
            : typeof body.attendance_date === 'string'
                ? body.attendance_date.trim()
                : '';
        expectedLastRecord = Object.prototype.hasOwnProperty.call(body, 'expected_last_record')
            ? typeof body.expected_last_record === 'string'
                ? body.expected_last_record
                : null
            : undefined;
        details = eventDetails(requestedAction, attendanceDate);

        if (!studentId || studentId.length > 100) {
            return NextResponse.json({ error: 'A valid student is required.' }, { status: 400 });
        }
        if (!ALLOWED_ACTIONS.has(actionValue)) {
            return NextResponse.json({ error: 'This attendance action is not supported.' }, { status: 400 });
        }
        if (requestedAction === 'mark' && !attendanceDate) {
            return NextResponse.json({ error: 'An attendance date is required.' }, { status: 400 });
        }
        if (requestedAction === 'undo' && expectedLastRecord === undefined) {
            return NextResponse.json(
                { error: 'Refresh the table before undoing attendance.' },
                { status: 409 },
            );
        }
        if (!canUseWeekendAttendanceDate({
            role: caller.role,
            action: requestedAction,
            dateKey: attendanceDate,
        })) {
            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'attendance',
                eventType: details.eventType,
                action: details.auditAction,
                outcome: 'denied',
                summary: 'A non-superuser attempted to record Weekend attendance for another date.',
                targetTable: 'students',
                targetRecordId: { student_id: studentId },
                metadata: {
                    attendance_date: attendanceDate,
                    reason: 'alternate_date_requires_superuser',
                },
            });
            return NextResponse.json(
                { error: 'Only superusers can record attendance for another date.' },
                { status: 403 },
            );
        }

        const authorization = request.headers.get('authorization') || '';
        const userClient = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                auth: { persistSession: false, autoRefreshToken: false },
                global: { headers: { Authorization: authorization } },
            },
        );

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const { data: student, error: fetchError } = await userClient
                .from('students')
                .select('student_id,student_name,student_day,student_timeslot,attended,missed,total_weeks,attendance_records,updated_at')
                .eq('student_id', studentId)
                .maybeSingle();

            if (fetchError) throw fetchError;
            if (!student) return NextResponse.json({ error: 'Student not found.' }, { status: 404 });

            const records = Array.isArray(student.attendance_records)
                ? [...student.attendance_records]
                : [];
            const attended = Number(student.attended || 0);
            const missed = Number(student.missed || 0);
            const totalWeeks = Number(student.total_weeks || 0);
            let nextAttended = attended;
            let nextMissed = missed;
            let nextRecords = [...records];
            let attendanceLabel = attendanceDate;
            let undoRpc: { name: string; args: Record<string, string> } | null = null;

            if (requestedAction === 'undo') {
                const currentLastRecord = records.length > 0
                    ? String(records[records.length - 1])
                    : null;
                if (currentLastRecord !== expectedLastRecord) {
                    return NextResponse.json(
                        { error: 'Attendance changed on another device. Refresh the table before undoing.' },
                        { status: 409 },
                    );
                }

                if (nextRecords.length === 0) {
                    return NextResponse.json({ error: 'There is no attendance action to undo.' }, { status: 409 });
                }

                const latestIndex = nextRecords.length - 1;
                const latestRecord = parseWeekendAttendanceRecord(nextRecords[latestIndex]);
                attendanceLabel = latestRecord.dateIso;

                if (latestRecord.status === 'makeup') {
                    nextAttended = Math.max(0, nextAttended - 1);
                    nextMissed += 1;
                    const missedDate = latestRecord.originalMissedDate || latestRecord.dateIso;
                    nextRecords[latestIndex] = `${missedDate}|missed`;
                    if (latestRecord.usageId) {
                        undoRpc = {
                            name: 'undo_cross_programme_makeup',
                            args: { input_usage_id: latestRecord.usageId },
                        };
                    }
                } else if (latestRecord.status === 'missed') {
                    nextMissed = Math.max(0, nextMissed - 1);
                    nextRecords.splice(latestIndex, 1);
                    undoRpc = {
                        name: 'cancel_weekend_missed_credit',
                        args: {
                            input_student_id: studentId,
                            input_missed_date: latestRecord.dateIso,
                        },
                    };
                } else {
                    nextAttended = Math.max(0, nextAttended - 1);
                    nextRecords.splice(latestIndex, 1);
                }
            } else if (requestedAction === 'mark') {
                const todayDateKey = singaporeDateKey();
                const validationError = attendanceDate === todayDateKey
                    ? validateCurrentWeekendAttendanceDate({
                        dateKey: attendanceDate,
                        studentDay: String(student.student_day || ''),
                        attendanceRecords: records,
                        todayDateKey,
                    })
                    : validateAlternateAttendanceDate({
                        dateKey: attendanceDate,
                        attendanceRecords: records,
                        todayDateKey,
                    });

                if (validationError) {
                    return NextResponse.json(
                        { error: validationError },
                        { status: validationError.includes('already exists') ? 409 : 400 },
                    );
                }
            } else if (records.some((record) => attendanceRecordDateKey(record) === attendanceDate)) {
                return NextResponse.json(
                    { error: 'Attendance already exists for this date.' },
                    { status: 409 },
                );
            }

            if (requestedAction !== 'undo') {
                if (attended + missed >= totalWeeks) {
                    return NextResponse.json(
                        { error: 'Total lessons for this subscription have already been used.' },
                        { status: 409 },
                    );
                }

                if (requestedAction === 'missed') {
                    nextMissed += 1;
                    nextRecords.push(`${attendanceDate}|missed`);
                } else {
                    nextAttended += 1;
                    nextRecords.push(attendanceDate);
                }
            }

            const updatedAt = new Date().toISOString();
            let update = userClient
                .from('students')
                .update({
                    attended: nextAttended,
                    missed: nextMissed,
                    attendance_records: nextRecords,
                    updated_at: updatedAt,
                })
                .eq('student_id', studentId);

            update = student.updated_at
                ? update.eq('updated_at', student.updated_at)
                : update.is('updated_at', null);

            const { data: updatedStudent, error: updateError } = await update
                .select('student_id,attended,missed,total_weeks,attendance_records,updated_at')
                .maybeSingle();

            if (updateError) throw updateError;
            if (!updatedStudent) {
                if (requestedAction === 'undo') {
                    return NextResponse.json(
                        { error: 'Attendance changed on another device. Refresh the table before undoing.' },
                        { status: 409 },
                    );
                }
                continue;
            }

            if (undoRpc) {
                const { error: undoError } = await userClient.rpc(undoRpc.name, undoRpc.args);
                if (undoError) {
                    const { data: rolledBack } = await userClient
                        .from('students')
                        .update({
                            attended,
                            missed,
                            attendance_records: records,
                            updated_at: student.updated_at,
                        })
                        .eq('student_id', studentId)
                        .eq('updated_at', updatedAt)
                        .select('student_id')
                        .maybeSingle();
                    if (!rolledBack) {
                        console.error('[attendance] Undo rollback could not restore the student row.');
                    }
                    throw undoError;
                }
            }

            const changedFields = [
                ...(nextAttended !== attended ? ['attended'] : []),
                ...(nextMissed !== missed ? ['missed'] : []),
                'attendance_records',
                'updated_at',
            ];
            const actionSummary = requestedAction === 'undo'
                ? `Undid the latest Weekend attendance action for ${student.student_name || 'a student'}.`
                : requestedAction === 'missed'
                    ? `Marked ${student.student_name || 'a student'} as missed on ${attendanceDate}.`
                    : `Recorded Weekend attendance for ${student.student_name || 'a student'} on ${attendanceDate}.`;

            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'data_change',
                category: 'attendance',
                eventType: details.eventType,
                action: details.auditAction,
                outcome: 'success',
                summary: actionSummary,
                actorSource: 'weekend_attendance_api',
                targetTable: 'students',
                targetRecordId: { student_id: studentId },
                targetLabel: student.student_name || 'Unknown student',
                changedFields,
                oldValues: { attended, missed },
                newValues: {
                    attended: nextAttended,
                    missed: nextMissed,
                    attendance_date: attendanceLabel || null,
                },
                metadata: {
                    attendance_date: attendanceLabel || null,
                    entry_mode: requestedAction === 'mark' && attendanceDate !== singaporeDateKey()
                        ? 'alternate_date'
                        : requestedAction,
                    scheduled_day: student.student_day,
                    session: student.student_timeslot,
                },
            });

            return NextResponse.json({ student: updatedStudent });
        }

        return NextResponse.json(
            { error: 'Attendance changed on another device. Refresh the table and try again.' },
            { status: 409 },
        );
    } catch (error) {
        console.error('[attendance] Weekend attendance change failed:', safeAuditError(error));
        await writeAuditEvent({
            request,
            actor: caller,
            category: 'attendance',
            eventType: details.eventType,
            action: details.auditAction,
            outcome: 'failure',
            summary: details.failureSummary,
            targetTable: 'students',
            targetRecordId: studentId ? { student_id: studentId } : null,
            metadata: {
                attendance_date: attendanceDate || null,
                reason: safeAuditError(error),
            },
        });
        return NextResponse.json({ error: details.failureSummary }, { status: 500 });
    }
}
