import { NextRequest, NextResponse } from 'next/server';
import { requireRole, serverAdmin } from '../../../lib/server-auth';

export async function GET(request: NextRequest) {
    try {
        const caller = await requireRole(request, ['admin', 'superuser']);
        if (!caller) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data, error } = await serverAdmin.auth.admin.listUsers();

        if (error) {
            return NextResponse.json(
                { error: error.message },
                { status: 400 }
            );
        }

        return NextResponse.json({
            users: data.users.map((user) => ({
                id: user.id,
                email: user.email,
                app_metadata: user.app_metadata,
                user_metadata: user.user_metadata,
                created_at: user.created_at,
                last_sign_in_at: user.last_sign_in_at,
            })),
        });
    } catch (error) {
        console.error('List users error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
