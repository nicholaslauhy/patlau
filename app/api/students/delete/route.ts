import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const token = authHeader.replace('Bearer ', '');

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
        if (authError || !user) {
            return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
        }

        // Only superusers can delete
        if (user.user_metadata?.role !== 'superuser') {
            return NextResponse.json(
                { error: 'Only superusers can delete students' },
                { status: 403 }
            );
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