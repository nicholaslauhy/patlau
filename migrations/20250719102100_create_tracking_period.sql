-- Create tracking_period table if it doesn't exist
CREATE OR REPLACE FUNCTION public.create_tracking_period_table()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'tracking_period'
  ) THEN
    CREATE TABLE public.tracking_period (
      id bigserial PRIMARY KEY,
      start_date timestamptz NOT NULL,
      end_date timestamptz NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid REFERENCES auth.users(id),
      CONSTRAINT valid_period CHECK (end_date > start_date)
    );

    -- There will only be one active tracking period
    INSERT INTO public.tracking_period (start_date, end_date)
    VALUES (now(), now() + interval '1 month');
  END IF;
END;
$$;
