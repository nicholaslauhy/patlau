import { NextRequest, NextResponse } from 'next/server';
import { createAuditedAdminClient, getOptionalAuditActor, safeAuditError, writeAuditEvent } from '../../../lib/audit-server';

export async function POST(request: NextRequest) {
    let caller: Awaited<ReturnType<typeof getOptionalAuditActor>> = null;

    try {
        caller = await getOptionalAuditActor(request);
        if (!caller) {
            await writeAuditEvent({
                request,
                actor: null,
                eventKind: 'security',
                category: 'students',
                eventType: 'student.delete',
                action: 'delete_student',
                outcome: 'denied',
                summary: 'An unauthorized student deletion was denied.',
                actorSource: 'anonymous',
                targetTable: 'students',
            });
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (caller.role !== 'superuser') {
            await writeAuditEvent({
                request,
                actor: caller,
                eventKind: 'security',
                category: 'students',
                eventType: 'student.delete',
                action: 'delete_student',
                outcome: 'denied',
                summary: 'A signed-in user without permission attempted to delete a student.',
                targetTable: 'students',
                metadata: { reason: 'insufficient_role' },
            });
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { student_id } = await request.json();
        if (!student_id) {
            await writeAuditEvent({
                request,
                actor: caller,
                category: 'students',
                eventType: 'student.delete',
                action: 'delete_student',
                outcome: 'failure',
                summary: 'A student deletion failed because no student was selected.',
                targetTable: 'students',
                metadata: { reason: 'missing_student_id' },
            });
            return NextResponse.json({ error: 'student_id required' }, { status: 400 });
        }

        const auditedAdmin = createAuditedAdminClient(request, caller, 'api.students.delete');
        const { data: student } = await auditedAdmin
            .from('students')
            .select('student_name')
            .eq('student_id', student_id)
            .maybeSingle();

        const { error } = await auditedAdmin
            .from('students')
            .delete()
            .eq('student_id', student_id);

        if (error) {
            console.error('Delete error:', error);
            await writeAuditEvent({
                request,
                actor: caller,
                category: 'students',
                eventType: 'student.delete',
                action: 'delete_student',
                outcome: 'failure',
                summary: `Failed to delete student ${student?.student_name || 'Unknown student'}.`,
                targetTable: 'students',
                targetRecordId: { student_id },
                targetLabel: student?.student_name || 'Unknown student',
                metadata: { reason: 'database_delete_failed' },
            });
            return NextResponse.json({ error: 'Failed to delete student' }, { status: 500 });
        }

        await writeAuditEvent({
            request,
            actor: caller,
            category: 'students',
            eventType: 'student.delete',
            action: 'delete_student',
            outcome: 'success',
            summary: `Deleted student ${student?.student_name || 'Unknown student'}.`,
            targetTable: 'students',
            targetRecordId: { student_id },
            targetLabel: student?.student_name || 'Unknown student',
        });

        return NextResponse.json({ message: 'Student deleted' });
    } catch (error) {
        console.error('Delete route error:', safeAuditError(error));
        await writeAuditEvent({
            request,
            actor: caller,
            category: 'students',
            eventType: 'student.delete',
            action: 'delete_student',
            outcome: 'failure',
            summary: 'A student deletion failed unexpectedly.',
            targetTable: 'students',
            metadata: { reason: 'unexpected_error' },
        });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
