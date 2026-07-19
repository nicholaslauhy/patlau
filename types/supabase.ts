export interface Student {
  student_id: string;
  student_name: string;
  student_day: string;
  student_timeslot: string;
  student_levelofplay: string;
  price: number;
  total_weeks: number;
  attended: number;
  missed: number;
  attendance_records?: string[];
  created_by: string | null;
  created_at: string;
  updated_at?: string;
  paid?: boolean;
}
