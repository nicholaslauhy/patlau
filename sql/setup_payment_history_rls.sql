-- Create payment_history table with RLS policies
BEGIN;

-- Create table if not exists
CREATE TABLE IF NOT EXISTS public.payment_history (
  id bigserial PRIMARY KEY,
  student_id text NOT NULL REFERENCES public.students(student_id),
  amount numeric NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.payment_history ENABLE ROW LEVEL SECURITY;

-- Read access for authenticated users
CREATE POLICY "Allow read access to all authenticated users" 
ON public.payment_history
FOR SELECT
TO authenticated
USING (true);

-- Insert access for authenticated users  
CREATE POLICY "Allow insert for authenticated users"
ON public.payment_history
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_payment_history_student_id ON public.payment_history(student_id);
CREATE INDEX IF NOT EXISTS idx_payment_history_recorded_at ON public.payment_history(recorded_at);

-- Grant permissions
GRANT ALL PRIVILEGES ON TABLE public.payment_history TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.payment_history_id_seq TO authenticated;

COMMIT;
