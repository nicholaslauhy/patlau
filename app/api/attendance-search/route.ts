import { NextResponse } from 'next/server'
import { requireRole, serverAdmin } from '../../lib/server-auth'

export async function POST(request: Request) {
  try {
    const caller = await requireRole(request, ['member', 'admin', 'superuser']);
    if (!caller) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const searchTerm = typeof body.searchTerm === 'string'
      ? body.searchTerm.trim().slice(0, 120)
      : '';
    const isWildcardReport = searchTerm === '%' || searchTerm === '*';
    const isReportRequest = body.report === true || isWildcardReport;
    
    if (!searchTerm) {
      return NextResponse.json(
        { message: 'Search term is required' },
        { status: 400 }
      );
    }

    if (!isReportRequest && caller.role !== 'superuser') {
      return NextResponse.json(
        { message: 'Forbidden' },
        { status: 403 }
      );
    }

    // Reports only need these five fields. Keep the full projection restricted
    // to the superuser attendance-management search so member/admin report
    // access cannot bypass RLS and expose unrelated student or payment data.
    const pageSize = 500;
    const results: Record<string, unknown>[] = [];

    for (let from = 0; ; from += pageSize) {
      let query = isReportRequest
        ? serverAdmin
            .from('students')
            .select('student_id,student_name,student_day,student_timeslot,attendance_records')
        : serverAdmin.from('students').select('*');

      // The native app uses "%" as its authenticated request for all Weekend
      // report records. Other searches are escaped before entering PostgREST's
      // filter grammar so punctuation cannot add an unintended filter.
      if (!isWildcardReport) {
        const safeTerm = searchTerm.replace(/[(),]/g, ' ');
        const filters = [
          `student_name.ilike.%${safeTerm}%`,
          `student_day.ilike.%${safeTerm}%`,
          `student_timeslot.ilike.%${safeTerm}%`,
          `student_levelofplay.ilike.%${safeTerm}%`
        ];

        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchTerm)) {
          filters.push(`student_id.eq.${searchTerm}`);
        }

        query = query.or(filters.join(','));
      }

      const { data, error } = await query
        .order('student_name', { ascending: true })
        .order('student_id', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) throw error;
      const page = (data || []) as Record<string, unknown>[];
      results.push(...page);
      if (page.length < pageSize) break;
    }

    return NextResponse.json({ 
      results
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
