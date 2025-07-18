import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { searchTerm } = body;
    
    if (!searchTerm) {
      return NextResponse.json(
        { message: 'Search term is required' },
        { status: 400 }
      );
    }

    let query = supabase
      .from('students')
      .select()
      .or([
        `student_name.ilike.%${searchTerm}%`,
        `student_day.ilike.%${searchTerm}%`, 
        `student_timeslot.ilike.%${searchTerm}%`,
        `student_levelofplay.ilike.%${searchTerm}%`
      ].join(','));

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchTerm)) {
      query = query.or(`student_id.eq.${searchTerm}`);
    }

    const { data, error } = await query
      .order('student_name', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ 
      results: data || [] 
    }, { 
      status: 200 
    });

  } catch (error) {
    console.error('Attendance search error:', error)
    return NextResponse.json(
      { message: 'Failed to perform attendance search' },
      { status: 500 }
    )
  }
}
