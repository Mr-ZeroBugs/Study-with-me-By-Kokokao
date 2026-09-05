-- KOKO REMINDER DELIVERY V0
-- Makes scheduled LINE reminders idempotent per learner and Bangkok date.
-- Migration 009. Run after 001_schema.sql. This table is service-role-only: learners never need
-- to read delivery telemetry, and it never contains task titles or messages.

CREATE TABLE IF NOT EXISTS public.notification_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  notification_key TEXT NOT NULL CHECK (char_length(notification_key) BETWEEN 1 AND 120),
  status TEXT NOT NULL CHECK (status IN ('processing', 'sent', 'failed')) DEFAULT 'processing',
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  locked_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  sent_at TIMESTAMPTZ,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (user_id, notification_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_log_recent
  ON public.notification_delivery_log (user_id, created_at DESC);

ALTER TABLE public.notification_delivery_log ENABLE ROW LEVEL SECURITY;

-- No client policy is intentionally created. The only callers are the server
-- cron route through the two narrowly scoped RPCs below.

CREATE OR REPLACE FUNCTION public.claim_notification_delivery(
  target_user_id UUID,
  target_notification_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  delivery_id UUID;
  delivery_status TEXT;
  last_locked_at TIMESTAMPTZ;
BEGIN
  IF target_user_id IS NULL OR char_length(trim(coalesce(target_notification_key, ''))) = 0 THEN
    RAISE EXCEPTION 'A user and notification key are required';
  END IF;

  INSERT INTO public.notification_delivery_log (user_id, notification_key)
  VALUES (target_user_id, trim(target_notification_key))
  ON CONFLICT (user_id, notification_key) DO NOTHING
  RETURNING id INTO delivery_id;

  IF delivery_id IS NOT NULL THEN
    RETURN delivery_id;
  END IF;

  SELECT id, status, locked_at
  INTO delivery_id, delivery_status, last_locked_at
  FROM public.notification_delivery_log
  WHERE user_id = target_user_id AND notification_key = trim(target_notification_key)
  FOR UPDATE;

  IF delivery_status = 'sent' THEN
    RETURN NULL;
  END IF;

  -- Do not let overlapping cron invocations double-send. A failed or stale
  -- attempt becomes retryable, while an actively processing attempt has a
  -- ten-minute lease.
  IF delivery_status = 'processing' AND last_locked_at > timezone('utc'::text, now()) - interval '10 minutes' THEN
    RETURN NULL;
  END IF;

  UPDATE public.notification_delivery_log
  SET status = 'processing', attempts = attempts + 1, locked_at = timezone('utc'::text, now()),
      sent_at = NULL, error_code = NULL, updated_at = timezone('utc'::text, now())
  WHERE id = delivery_id;

  RETURN delivery_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_notification_delivery(
  target_delivery_id UUID,
  did_send BOOLEAN,
  failure_code TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notification_delivery_log
  SET status = CASE WHEN did_send THEN 'sent' ELSE 'failed' END,
      sent_at = CASE WHEN did_send THEN timezone('utc'::text, now()) ELSE NULL END,
      error_code = CASE WHEN did_send THEN NULL ELSE left(coalesce(failure_code, 'delivery_failed'), 120) END,
      updated_at = timezone('utc'::text, now())
  WHERE id = target_delivery_id AND status = 'processing';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON TABLE public.notification_delivery_log FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_notification_delivery(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_notification_delivery(UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_notification_delivery(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_notification_delivery(UUID, BOOLEAN, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
