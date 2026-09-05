-- KOKO ADAPTIVE PLANNER V0
-- Compact behavioral signals only; no task text, Team Space content, or LLM
-- transcript is stored here. RLS keeps every learner's history private.

CREATE TABLE IF NOT EXISTS public.user_planner_behavior_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('next_action_accepted', 'task_completed')),
  subject TEXT NOT NULL CHECK (char_length(trim(subject)) BETWEEN 1 AND 80),
  task_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_user_planner_behavior_recent
  ON public.user_planner_behavior_events (user_id, occurred_at DESC);

ALTER TABLE public.user_planner_behavior_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own planner behavior" ON public.user_planner_behavior_events;
CREATE POLICY "Users manage their own planner behavior" ON public.user_planner_behavior_events
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
