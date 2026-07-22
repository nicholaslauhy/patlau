import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
    getOptionalAuditActor,
    safeAuditError,
    writeAuditEvent,
} from '../../../lib/audit-server';
import { validateEarlierOneToOneAttendance } from '../../../lib/one-to-one-attendance-date';
import { singaporeDateKey } from '../../../lib/weekend-attendance-date';

const ALLOWED_ROLES = new Set(['admin', 'superuser']);
const SESSION_FIELDS = 'id,session_date,student_id,coach_id,removed_from_training,removed_at,payment_exempt,payment_exempt_at,attendance_status,attendance_updated_at,makeup_target_type,makeup_usage_id,created_at,updated_at';

type AuditActor = Awaited<ReturnType<typeof getOptionalAuditActor>>;

const json = (body: unknown, init?: ResponseInit) => {
    const response = NextResponse.json(body, init);
    response.headers.set('Cache-Control', 'no-store');
    return response;
};

async function auditDenied({
    request,
    actor,
    sessionId,
    summary,
    reason,
}: {
    request: NextRequest;
    actor: AuditActor;
    sessionId?: number | null;
    summary: string;
    reason: string;
}) {
    await writeAuditEvent({
        request,
        actor,
        eventKind: 'security',
        category: 'attendance',
        eventType: 'attendance.one_to_one.earlier.denied',
        action: 'mark_earlier_attendance',
        outcome: 'denied',
        summary,
        actorSource: actor ? 'one_to_one_attendance_api' : 'anonymous',
        targetTable: 'one_to_one_sessions',
        targetRecordId: sessionId ? { one_to_one_session_id: sessionId } : null,
        metadata: { reason },
    });
}

export async function POST(request: NextRequest) {
    let actor: AuditActor = null;
    let sessionId: number | null = null;
    let sessionDate = '';
    let studentName = 'Unknown student';

    try {
        actor = await getOptionalAuditActor(request);
        if (!actor) {
            await auditDenied({
                request,
                actor: null,
                summary: 'An unauthenticated request to mark earlier 1-1 attendance was denied.',
                reason: 'unauthenticated',
            });
            return json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Only the server-managed app_metadata role can authorize mutations;
        // user_metadata is editable by the signed-in user.
        const protectedRole = actor.user.app_metadata?.role;
        if (typeof protectedRole !== 'string' || !ALLOWED_ROLES.has(protectedRole)) {
            await auditDenied({
                request,
                actor,
                summary: 'A user without permission attempted to mark earlier 1-1 attendance.',
                reason: 'insufficient_role',
            });
            return json({ error: 'Forbidden' }, { status: 403 });
        }

        let body: Record<string, unknown>;
        try {
            const parsed = await request.json();
            body = parsed && typeof parsed === 'object'
                ? parsed as Record<string, unknown>
                : {};
        } catch {
            await auditDenied({
                request,
                actor,
                summary: 'An invalid earlier 1-1 attendance request was denied.',
                reason: 'invalid_json',
            });
            return json({ error: 'A valid session is required.' }, { status: 400 });
        }

        const rawSessionId = body.session_id;
        sessionId = typeof rawSessionId === 'number'
            ? rawSessionId
            : typeof rawSessionId === 'string' && /^\d+$/.test(rawSessionId.trim())
                ? Number(rawSessionId.trim())
                : null;

        if (!Number.isSafeInteger(sessionId) || Number(sessionId) <= 0) {
            await auditDenied({
                request,
                actor,
                sessionId,
                summary: 'An invalid earlier 1-1 attendance request was denied.',
                reason: 'invalid_session_id',
            });
            return json({ error: 'A valid session is required.' }, { status: 400 });
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

        const { data: session, error: sessionError } = await userClient
            .from('one_to_one_sessions')
            .select(SESSION_FIELDS)
            .eq('id', sessionId)
            .maybeSingle();
        if (sessionError) throw sessionError;
        if (!session) {
            await auditDenied({
                request,
                actor,
                sessionId,
                summary: 'An earlier 1-1 attendance request for an unavailable lesson was denied.',
                reason: 'session_not_found_or_not_visible',
            });
            return json({ error: '1-1 lesson not found.' }, { status: 404 });
        }

        sessionDate = String(session.session_date || '').slice(0, 10);

        const { data: student, error: studentError } = await userClient
            .from('one_to_one_students')
            .select('id,student_name,active')
            .eq('id', session.student_id)
            .maybeSingle();
        if (studentError) throw studentError;

        studentName = String(student?.student_name || 'Unknown student');
        const eligibilityError = validateEarlierOneToOneAttendance({
            sessionDate,
            attendanceStatus: session.attendance_status,
            makeupTargetType: session.makeup_target_type,
            makeupUsageId: session.makeup_usage_id,
            removedFromTraining: session.removed_from_training,
            removedAt: session.removed_at,
            studentActive: student?.active === true,
            todayDateKey: singaporeDateKey(),
        });

        if (eligibilityError) {
            await auditDenied({
                request,
                actor,
                sessionId,
                summary: `Could not mark earlier 1-1 attendance for ${studentName}.`,
                reason: eligibilityError,
            });
            return json({ error: eligibilityError }, { status: 409 });
        }

        const updatedAt = new Date().toISOString();
        let update = userClient
            .from('one_to_one_sessions')
            .update({
                attendance_status: 'attended',
                attendance_updated_at: updatedAt,
                makeup_target_type: null,
                makeup_usage_id: null,
                updated_at: updatedAt,
            })
            .eq('id', sessionId)
            .eq('session_date', session.session_date)
            .eq('student_id', session.student_id)
            .eq('coach_id', session.coach_id)
            .is('removed_at', null);

        update = session.updated_at
            ? update.eq('updated_at', session.updated_at)
            : update.is('updated_at', null);
        update = session.attendance_status === null || session.attendance_status === undefined
            ? update.is('attendance_status', null)
            : update.eq('attendance_status', 'scheduled');
        update = session.removed_from_training === null || session.removed_from_training === undefined
            ? update.is('removed_from_training', null)
            : update.eq('removed_from_training', false);

        const { data: updatedSession, error: updateError } = await update
            .select(SESSION_FIELDS)
            .maybeSingle();
        if (updateError) throw updateError;

        if (!updatedSession) {
            await auditDenied({
                request,
                actor,
                sessionId,
                summary: `Earlier 1-1 attendance for ${studentName} was not recorded because the lesson changed.`,
                reason: 'concurrent_change',
            });
            return json(
                { error: 'This lesson changed on another device. Refresh and try again.' },
                { status: 409 },
            );
        }

        await writeAuditEvent({
            request,
            actor,
            eventKind: 'data_change',
            category: 'attendance',
            eventType: 'attendance.one_to_one.earlier.marked',
            action: 'mark_earlier_attendance',
            outcome: 'success',
            summary: `Recorded 1-1 attendance for ${studentName} on ${sessionDate}.`,
            actorSource: 'one_to_one_attendance_api',
            targetTable: 'one_to_one_sessions',
            targetRecordId: { one_to_one_session_id: sessionId },
            targetLabel: studentName,
            changedFields: [
                'attendance_status',
                'attendance_updated_at',
                'makeup_target_type',
                'makeup_usage_id',
                'updated_at',
            ],
            oldValues: {
                attendance_status: session.attendance_status || 'scheduled',
                makeup_target_type: session.makeup_target_type,
                makeup_usage_id: session.makeup_usage_id,
            },
            newValues: {
                attendance_status: 'attended',
                attendance_updated_at: updatedAt,
                makeup_target_type: null,
                makeup_usage_id: null,
            },
            metadata: {
                attendance_date: sessionDate,
                entry_mode: 'earlier_existing_session',
                student_id: session.student_id,
                coach_id: session.coach_id,
                booking_date_unchanged: true,
                payment_record_unchanged: true,
            },
        });

        return json({ session: updatedSession });
    } catch (error) {
        console.error('[attendance] Earlier 1-1 attendance failed:', safeAuditError(error));
        await writeAuditEvent({
            request,
            actor,
            category: 'attendance',
            eventType: 'attendance.one_to_one.earlier.failure',
            action: 'mark_earlier_attendance',
            outcome: 'failure',
            summary: 'Failed to record earlier 1-1 attendance.',
            actorSource: actor ? 'one_to_one_attendance_api' : 'anonymous',
            targetTable: 'one_to_one_sessions',
            targetRecordId: sessionId ? { one_to_one_session_id: sessionId } : null,
            targetLabel: studentName === 'Unknown student' ? null : studentName,
            metadata: {
                attendance_date: sessionDate || null,
                reason: safeAuditError(error),
            },
        });
        return json({ error: 'Failed to record earlier 1-1 attendance.' }, { status: 500 });
    }
}
