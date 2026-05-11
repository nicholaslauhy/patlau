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
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        const token = authHeader.replace('Bearer ', '');

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
        if (authError || !user) {
            return NextResponse.json(
                { error: 'Invalid token' },
                { status: 401 }
            );
        }

        const { student_id, action } = await request.json();

        if (!student_id || !action) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Validate action type
        const validActions = ['mark', 'makeup', 'undo', 'reset', 'delete', 'missed'];
        if (!validActions.includes(action)) {
            return NextResponse.json(
                { error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
                { status: 400 }
            );
        }

        // Insert into student_audit table
        const { error } = await supabaseAdmin
            .from('student_audit')
            .insert([
                {
                    student_id,
                    created_by: user.id,
                    action,
                    created_at: new Date().toISOString()
                }
            ]);

        if (error) {
            console.error('Audit log error:', error);
            return NextResponse.json(
                { error: 'Failed to log action' },
                { status: 500 }
            );
        }

        return NextResponse.json({ message: 'Action logged' });
    } catch (error) {
        console.error('Log attendance route error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}