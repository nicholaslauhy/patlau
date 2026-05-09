import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { jwtDecode } from 'jwt-decode';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface JwtPayload {
    user_metadata?: {
        role?: string;
    };
    app_metadata?: {
        role?: string;
    };
}

export async function POST(request: NextRequest) {
    try {
        const { userId, role } = await request.json();

        if (!userId || !role) {
            return NextResponse.json(
                { error: 'userId and role are required' },
                { status: 400 }
            );
        }

        // Validate role
        if (!['member', 'admin', 'superuser'].includes(role)) {
            return NextResponse.json(
                { error: 'Invalid role' },
                { status: 400 }
            );
        }

        // Get the caller's token from Authorization header
        const authHeader = request.headers.get('authorization');
        if (!authHeader) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        const token = authHeader.replace('Bearer ', '');

        // Decode the JWT to get caller's role
        let callerRole: string | undefined;
        try {
            const decoded = jwtDecode<JwtPayload>(token);
            // Check both user_metadata and app_metadata
            callerRole = decoded.user_metadata?.role || decoded.app_metadata?.role;
        } catch (err) {
            return NextResponse.json(
                { error: 'Invalid token' },
                { status: 401 }
            );
        }

        // Only superusers can update roles
        if (callerRole !== 'superuser') {
            return NextResponse.json(
                { error: 'Only superusers can update user roles' },
                { status: 403 }
            );
        }

        // Update the user's role in metadata
        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            user_metadata: {
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