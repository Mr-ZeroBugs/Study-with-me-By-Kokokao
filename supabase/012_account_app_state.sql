-- ACCOUNT APP STATE V1
-- Small account-scoped UI state that does not belong in the normalized
-- planner, study, ontology, behavior, or memory tables.

CREATE TABLE IF NOT EXISTS public.user_app_state (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  namespace TEXT NOT NULL CHECK (char_length(namespace) BETWEEN 1 AND 80),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (user_id, namespace)
);

ALTER TABLE public.user_app_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own app state" ON public.user_app_state;
CREATE POLICY "Users read their own app state" ON public.user_app_state
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users create their own app state" ON public.user_app_state;
CREATE POLICY "Users create their own app state" ON public.user_app_state
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update their own app state" ON public.user_app_state;
CREATE POLICY "Users update their own app state" ON public.user_app_state
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete their own app state" ON public.user_app_state;
CREATE POLICY "Users delete their own app state" ON public.user_app_state
  FOR DELETE USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_app_state TO authenticated;

NOTIFY pgrst, 'reload schema';
