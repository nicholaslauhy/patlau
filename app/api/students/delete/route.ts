import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '../../../lib/server-auth';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
    try {
        const caller = await requireRole(request, ['superuser']);
        if (!caller) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { student_id } = await request.json();
        if (!student_id) {
            return NextResponse.json({ error: 'student_id required' }, { status: 400 });
        }

        const { error } = await supabaseAdmin
            .from('students')
            .delete()
            .eq('student_id', student_id);

        if (error) {
            console.error('Delete error:', error);
            return NextResponse.json({ error: 'Failed to delete student' }, { status: 500 });
        }

        return NextResponse.json({ message: 'Student deleted' });
    } catch (error) {
        console.error('Delete route error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
