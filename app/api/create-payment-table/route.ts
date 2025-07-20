import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // First verify the user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.split(' ')[1]);
    if (authError || !user) throw new Error('Not authenticated');

    // Create payment_history table if it doesn't exist
    const { data, error } = await supabase.rpc('create_payment_history_table');
    
    if (error) {
      if (!error.message.includes('already exists')) {
        throw error;
      }
      return NextResponse.json({ 
        success: true, 
        message: 'Payment table already exists' 
      });
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Payment table created successfully' 
    });
  } catch (error) {
    console.error('Error creating payment table:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
