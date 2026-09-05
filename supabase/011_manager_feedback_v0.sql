-- KOKO MANAGER FEEDBACK V0
-- Stores only bounded interaction signals. It deliberately excludes task
-- titles, messages, transcripts, and Team Space content.

CREATE TABLE IF NOT EXISTS public.manager_feedback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  request_id UUID NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('next_action', 'proactive_window', 'insight')),
  recommendation_key TEXT NOT NULL CHECK (char_length(recommendation_key) BETWEEN 1 AND 160),
  event_type TEXT NOT NULL CHECK (event_type IN ('accepted', 'dismissed', 'not_helpful')),
  subject TEXT CHECK (subject IS NULL OR char_length(trim(subject)) BETWEEN 1 AND 80),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (user_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_manager_feedback_recent
  ON public.manager_feedback_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_manager_feedback_recommendation
  ON public.manager_feedback_events (user_id, surface, recommendation_key, occurred_at DESC);

ALTER TABLE public.manager_feedback_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own manager feedback" ON public.manager_feedback_events;
CREATE POLICY "Users manage their own manager feedback" ON public.manager_feedback_events
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
