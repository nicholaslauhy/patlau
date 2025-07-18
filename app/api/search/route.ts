import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  try {
    console.log('Received search request');
    const body = await request.json();
    console.log('Request body:', body);
    
    const { searchTerm } = body;
    if (!searchTerm) {
      console.log('No search term provided');
      return NextResponse.json(
        { message: 'Search term is required' },
        { status: 400 }
      );
    }

    console.log('Searching for:', searchTerm);
    let query = supabase
      .from('students')
      .select()
      .or([
        `student_name.ilike.%${searchTerm}%`,
        `student_day.ilike.%${searchTerm}%`, 
        `student_timeslot.ilike.%${searchTerm}%`,
        `student_levelofplay.ilike.%${searchTerm}%`
      ].join(','));

    // Add exact match for UUID if search term looks like a UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchTerm)) {
      query = query.or(`student_id.eq.${searchTerm}`);
    }

    const { data, error } = await query
      .order('student_name', { ascending: true });

    if (error) {
      console.error('Supabase search error:', error);
      throw error;
    }

    console.log('Found', data?.length, 'results');
    return NextResponse.json({ 
      results: data || [] 
    }, { 
      status: 200 
    });

  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json(
      { message: 'Failed to perform search' },
      { status: 500 }
    )
  }
}
