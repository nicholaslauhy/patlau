import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

const supabaseAuthClient = createClient(supabaseUrl, anonKey);

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

        const authHeader = request.headers.get('authorization');

        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        const token = authHeader.replace('Bearer ', '');

        // Verify token properly instead of only decoding it
        const {
            data: { user: caller },
            error: authError
        } = await supabaseAuthClient.auth.getUser(token);

        if (authError || !caller) {
            return NextResponse.json(
                { error: 'Invalid or expired token' },
                { status: 401 }
            );
        }

        const callerRole = caller.user_metadata?.role as UserRole | undefined;

        if (callerRole !== 'superuser') {
            return NextResponse.json(
                { error: 'Only superusers can update user roles' },
                { status: 403 }
            );
        }

        // Important: prevent self-demotion / self-role-change
        if (caller.id === userId) {
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

        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
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