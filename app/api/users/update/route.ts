import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '../../../lib/server-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

type UserRole = 'member' | 'admin' | 'superuser';

const VALID_ROLES: UserRole[] = ['member', 'admin', 'superuser'];

export async function POST(request: NextRequest) {
    try {
        const { userId, role } = await request.json();

        if (!userId || !role) {
            return NextResponse.json(
                { error: 'userId and role are required' },
                { status: 400 }
            );
        }

        if (!VALID_ROLES.includes(role as UserRole)) {
            return NextResponse.json(
                { error: 'Invalid role' },
                { status: 400 }
            );
        }

        const caller = await requireRole(request, ['superuser']);
        if (!caller) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Important: prevent self-demotion / self-role-change
        if (caller.user.id === userId) {
            return NextResponse.json(
                { error: 'You cannot change your own role.' },
                { status: 403 }
            );
        }

        // Get target user first so we preserve existing metadata like name
        const { data: targetData, error: targetError } =
            await supabaseAdmin.auth.admin.getUserById(userId);

        if (targetError || !targetData.user) {
            return NextResponse.json(
                { error: 'Target user not found' },
                { status: 404 }
            );
        }

        const existingMetadata = targetData.user.user_metadata || {};
        const existingAppMetadata = targetData.user.app_metadata || {};

        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            app_metadata: {
                ...existingAppMetadata,
                role,
            },
            user_metadata: {
                ...existingMetadata,
                role
            }
        });

        if (error) {
            console.error('Update user role error:', error);
            return NextResponse.json(
                { error: 'Failed to update user role' },
                { status: 400 }
            );
        }

        return NextResponse.json({
            message: 'User role updated successfully',
            user: data.user
        });
    } catch (error) {
        console.error('Update user route error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
