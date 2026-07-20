import { NextRequest, NextResponse } from 'next/server';
import { getStoredUserRole, requireRole, serverAdmin } from '../../../lib/server-auth';

export async function POST(request: NextRequest) {
    try {
        const caller = await requireRole(request, ['admin', 'superuser']);
        if (!caller) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { userId } = await request.json();

        if (!userId) {
            return NextResponse.json(
                { error: 'User ID is required' },
                { status: 400 }
            );
        }

        if (caller.user.id === userId) {
            return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 403 });
        }

        const { data: targetData, error: targetError } =
            await serverAdmin.auth.admin.getUserById(userId);
        if (targetError || !targetData.user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const targetRole = getStoredUserRole(targetData.user);
        if (caller.role === 'admin' && targetRole !== 'member') {
            return NextResponse.json(
                { error: 'Admins can only delete member accounts' },
                { status: 403 },
            );
        }

        const avatarPath = targetData.user.user_metadata?.avatar_path as string | undefined;

        const { error } = await serverAdmin.auth.admin.deleteUser(userId);

        if (error) {
            return NextResponse.json(
                { error: error.message },
                { status: 400 }
            );
        }

        if (avatarPath) {
            const { error: photoError } = await serverAdmin.storage.from('avatars').remove([avatarPath]);
            if (photoError) console.warn('Unable to remove deleted user profile photo:', photoError.message);
        }

        return NextResponse.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
