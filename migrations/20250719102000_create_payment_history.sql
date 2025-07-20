-- Create payment_history table if it doesn't exist
CREATE OR REPLACE FUNCTION public.create_payment_history_table()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'payment_history'
  ) THEN
    CREATE TABLE public.payment_history (
      id bigserial PRIMARY KEY,
      student_id text NOT NULL,
      amount numeric NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_student
        FOREIGN KEY(student_id) 
        REFERENCES students(student_id)
    );
    
    CREATE INDEX idx_payment_history_student_id ON public.payment_history(student_id);
    CREATE INDEX idx_payment_history_recorded_at ON public.payment_history(recorded_at);
  END IF;
END;
$$;
