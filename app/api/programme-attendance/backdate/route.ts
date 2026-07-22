import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
    getOptionalAuditActor,
    safeAuditError,
    writeAuditEvent,
} from '../../../lib/audit-server';
import { programmeAttendanceUsedDateKeys } from '../../../lib/programme-attendance-backdate';
import { validateAlternateAttendanceDate } from '../../../lib/weekend-attendance-date';

type BackdateProgramme = 'weekday' | 'matchplay';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEEKDAY_NAMES = new Set(['Monday', 'Wednesday', 'Thursday']);

const json = (body: unknown, init?: ResponseInit) => {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
};

export async function POST(request: NextRequest) {
    let actor: Awaited<ReturnType<typeof getOptionalAuditActor>> = null;
    let programme: BackdateProgramme | '' = '';
    let studentId = '';
    let attendanceDate = '';

    try {
        actor = await getOptionalAuditActor(request);
        if (!actor) {
            await writeAuditEvent({
                request,
                actor: null,
                eventKind: 'security',
                category: 'attendance',
                eventType: 'attendance.backdated.denied',
                action: 'mark_attendance_for_date',
                outcome: 'denied',
                summary: 'An unauthenticated backdated attendance request was denied.',
                actorSource: 'anonymous',
            });
            return json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Authorization must rely on protected app metadata. Users can edit
        // their own user_metadata, so the legacy display-role fallback is not
        // sufficient for a server-side mutation.
        if (actor.user.app_metadata?.role !== 'superuser') {
            await writeAuditEvent({
                request,
                actor,
                eventKind: 'security',
                category: 'attendance',
                eventType: 'attendance.backdated.denied',
                action: 'mark_attendance_for_date',
                outcome: 'denied',
                summary: 'A user without permission attempted to record backdated attendance.',
                metadata: { reason: 'insufficient_role' },
            });
            return json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        programme = body.programme === 'weekday' || body.programme === 'matchplay'
            ? body.programme
            : '';
        studentId = typeof body.student_id === 'string' ? body.student_id.trim() : '';
        attendanceDate = typeof body.attendance_date === 'string'
            ? body.attendance_date.trim()
            : '';

        if (!programme) return json({ error: 'A supported programme is required.' }, { status: 400 });
        if (!UUID_PATTERN.test(studentId)) return json({ error: 'A valid student is required.' }, { status: 400 });

        const initialDateError = validateAlternateAttendanceDate({
            dateKey: attendanceDate,
            attendanceRecords: [],
        });
        if (initialDateError) return json({ error: initialDateError }, { status: 400 });

        const authorization = request.headers.get('authorization') || '';
        const userClient = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                auth: { persistSession: false, autoRefreshToken: false },
                global: { headers: { Authorization: authorization } },
            },
        );

        let inserted: Record<string, unknown>;
        let studentName = 'Unknown student';
        let targetTable = '';
        let metadata: Record<string, unknown> = {
            programme,
            attendance_date: attendanceDate,
            entry_mode: 'alternate_date',
        };

        if (programme === 'weekday') {
            const dayName = typeof body.day_name === 'string' ? body.day_name.trim() : '';
            const durationHours = Number(body.duration_hours);
            if (!WEEKDAY_NAMES.has(dayName)) {
                return json({ error: 'A valid Weekday session is required.' }, { status: 400 });
            }
            if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > 24) {
                return json({ error: 'Session hours must be between 0 and 24.' }, { status: 400 });
            }

            const { data: student, error: studentError } = await userClient
                .from('weekday_students')
                .select('id,student_name,schedules,active')
                .eq('id', studentId)
                .eq('active', true)
                .maybeSingle();
            if (studentError) throw studentError;
            if (!student) return json({ error: 'Weekday student not found.' }, { status: 404 });

            const schedules = Array.isArray(student.schedules) ? student.schedules : [];
            const hasSchedule = schedules.some((schedule: unknown) => (
                Boolean(schedule)
                && typeof schedule === 'object'
                && 'day' in schedule
                && String((schedule as { day?: unknown }).day) === dayName
            ));
            if (!hasSchedule) {
                return json({ error: `This student no longer has a ${dayName} session.` }, { status: 409 });
            }

            const { data: existing, error: existingError } = await userClient
                .from('weekday_attendance')
                .select('id,attendance_date,original_missed_date')
                .eq('weekday_student_id', studentId);
            if (existingError) throw existingError;

            const dateError = validateAlternateAttendanceDate({
                dateKey: attendanceDate,
                attendanceRecords: programmeAttendanceUsedDateKeys((existing || []) as Array<Record<string, unknown>>),
            });
            if (dateError) return json({ error: dateError }, { status: 409 });

            const { data, error } = await userClient
                .from('weekday_attendance')
                .insert({
                    weekday_student_id: studentId,
                    attendance_date: attendanceDate,
                    day_name: dayName,
                    status: 'attended',
                    duration_hours: durationHours,
                    updated_at: new Date().toISOString(),
                })
                .select('*')
                .single();
            if (error) throw error;

            inserted = data as Record<string, unknown>;
            studentName = String(student.student_name || 'Unknown student');
            targetTable = 'weekday_attendance';
            metadata = { ...metadata, scheduled_day: dayName, duration_hours: durationHours };
        } else {
            const { data: student, error: studentError } = await userClient
                .from('matchplay_students')
                .select('id,student_name,active')
                .eq('id', studentId)
                .eq('active', true)
                .maybeSingle();
            if (studentError) throw studentError;
            if (!student) return json({ error: 'MatchPlay student not found.' }, { status: 404 });

            const { data: existing, error: existingError } = await userClient
                .from('matchplay_attendance')
                .select('id,attendance_date,original_missed_date')
                .eq('matchplay_student_id', studentId);
            if (existingError) throw existingError;

            const dateError = validateAlternateAttendanceDate({
                dateKey: attendanceDate,
                attendanceRecords: programmeAttendanceUsedDateKeys((existing || []) as Array<Record<string, unknown>>),
            });
            if (dateError) return json({ error: dateError }, { status: 409 });

            const { data, error } = await userClient
                .from('matchplay_attendance')
                .insert({
                    matchplay_student_id: studentId,
                    attendance_date: attendanceDate,
                    status: 'attended',
                    updated_at: new Date().toISOString(),
                })
                .select('*')
                .single();
            if (error) throw error;

            inserted = data as Record<string, unknown>;
            studentName = String(student.student_name || 'Unknown student');
            targetTable = 'matchplay_attendance';
        }

        await writeAuditEvent({
            request,
            actor,
            eventKind: 'data_change',
            category: 'attendance',
            eventType: `attendance.${programme}.backdated`,
            action: 'mark_attendance_for_date',
            outcome: 'success',
            summary: `Recorded ${programme === 'matchplay' ? 'MatchPlay' : 'Weekday'} attendance for ${studentName} on ${attendanceDate}.`,
            actorSource: 'programme_attendance_api',
            targetTable,
            targetRecordId: inserted.id ? { id: inserted.id } : null,
            targetLabel: studentName,
            changedFields: ['attendance_date', 'status'],
            newValues: { attendance_date: attendanceDate, status: 'attended' },
            metadata,
        });

        return json({ attendance: inserted }, { status: 201 });
    } catch (error) {
        const errorCode = error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code || '')
            : '';
        if (errorCode === '23505') {
            return json({ error: 'Attendance already exists for this date.' }, { status: 409 });
        }

        console.error('[attendance] Backdated programme attendance failed:', safeAuditError(error));
        await writeAuditEvent({
            request,
            actor,
            category: 'attendance',
            eventType: 'attendance.backdated.failure',
            action: 'mark_attendance_for_date',
            outcome: 'failure',
            summary: 'Failed to record backdated programme attendance.',
            targetRecordId: studentId ? { student_id: studentId } : null,
            metadata: {
                programme: programme || null,
                attendance_date: attendanceDate || null,
                reason: safeAuditError(error),
            },
        });
        return json({ error: 'Failed to record attendance for the selected date.' }, { status: 500 });
    }
}
