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

-- Weekend payment history is restricted to superusers.
CREATE POLICY "payment history read for superusers"
ON public.payment_history
FOR SELECT
TO authenticated
USING ((SELECT public.current_app_role()) = 'superuser');

CREATE POLICY "payment history insert for superusers"
ON public.payment_history
FOR INSERT
TO authenticated
WITH CHECK ((SELECT public.current_app_role()) = 'superuser');

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_payment_history_student_id ON public.payment_history(student_id);
CREATE INDEX IF NOT EXISTS idx_payment_history_recorded_at ON public.payment_history(recorded_at);

-- Grant permissions
GRANT ALL PRIVILEGES ON TABLE public.payment_history TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.payment_history_id_seq TO authenticated;

COMMIT;
