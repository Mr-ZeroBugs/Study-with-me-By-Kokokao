-- =============================================================================
-- KOKO PERSONAL ONTOLOGY V0
-- =============================================================================
-- Additive migration: this intentionally leaves the V1 planner/focus tables
-- untouched. Existing `subject TEXT` columns remain the compatibility layer
-- while the app gradually moves to canonical subject IDs and relationships.
-- Migration 003. Run after 001_schema.sql and 002_line_integration.sql.

-- Canonical personal subjects. A subject is a concrete thing a learner can
-- focus on, such as "SAT Math" or "A-Level Biology".
CREATE TABLE IF NOT EXISTS public.ontology_subjects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  color TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id, name)
);

-- A group is the learner's own higher-level lens, e.g. "Math" containing
-- SAT Math, A-Level Math, and competition practice. It is deliberately not a
-- replacement for the old plant-goal model: one group can hold several
-- concrete subjects without being tied to a one-off plant card.
CREATE TABLE IF NOT EXISTS public.ontology_subject_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '',
  color TEXT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS public.ontology_subject_group_members (
  group_id UUID REFERENCES public.ontology_subject_groups(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.ontology_subjects(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  PRIMARY KEY (group_id, subject_id)
);

-- Koko Rhythm replaces the legacy plant-goal model with active goals. A
-- Rhythm Goal is intentionally a durable energy commitment (e.g. "Math"),
-- backed by a subject group; it is not a daily priority list. The major/minor
-- role can change without deleting the goal or its subject relationships.
CREATE TABLE IF NOT EXISTS public.ontology_rhythm_goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '',
  subject_group_id UUID REFERENCES public.ontology_subject_groups(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'unassigned' CHECK (role IN ('major', 'minor', 'unassigned')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ontology_one_major_per_user
  ON public.ontology_rhythm_goals (user_id)
  WHERE role = 'major' AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS ontology_one_minor_per_user
  ON public.ontology_rhythm_goals (user_id)
  WHERE role = 'minor' AND status = 'active';

-- Maintenance is not another goal. It records a small per-subject practice
-- that must stay below the user's energy ceiling (20 minutes per subject).
CREATE TABLE IF NOT EXISTS public.ontology_maintenance_practices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject_id UUID REFERENCES public.ontology_subjects(id) ON DELETE CASCADE NOT NULL,
  minutes_per_day INTEGER NOT NULL CHECK (minutes_per_day BETWEEN 1 AND 20),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id, subject_id)
);

-- Immutable-ish event log. It gives future AI actions an auditable trail and
-- gives users a basis for undo/review without making an LLM the source of
-- truth. The trigger below starts recording existing planner mutations now.
CREATE TABLE IF NOT EXISTS public.ontology_action_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  workspace_id UUID REFERENCES public.shared_workspaces(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'database' CHECK (source IN ('web', 'line', 'agent', 'database', 'system')),
  before_state JSONB,
  after_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.ontology_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ontology_subject_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ontology_subject_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ontology_rhythm_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ontology_maintenance_practices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ontology_action_logs ENABLE ROW LEVEL SECURITY;

-- Helper functions are security definers solely to avoid recursive RLS checks.
CREATE OR REPLACE FUNCTION public.owns_ontology_subject(target_subject_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ontology_subjects
    WHERE id = target_subject_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_ontology_group(target_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ontology_subject_groups
    WHERE id = target_group_id AND user_id = auth.uid()
  );
$$;

-- These RPCs are the first bounded Ontology action surface. They keep the
-- authorization check and multi-row mutation together so a client or future
-- agent cannot accidentally leave a group half-updated.
CREATE OR REPLACE FUNCTION public.replace_ontology_group_subjects(
  target_group_id UUID,
  next_subject_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.owns_ontology_group(target_group_id) THEN
    RAISE EXCEPTION 'You cannot update this subject group';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(next_subject_ids, ARRAY[]::UUID[])) AS candidate(id)
    WHERE NOT public.owns_ontology_subject(candidate.id)
  ) THEN
    RAISE EXCEPTION 'Every linked subject must belong to you';
  END IF;

  DELETE FROM public.ontology_subject_group_members WHERE group_id = target_group_id;

  INSERT INTO public.ontology_subject_group_members (group_id, subject_id)
  SELECT DISTINCT target_group_id, candidate.id
  FROM unnest(COALESCE(next_subject_ids, ARRAY[]::UUID[])) AS candidate(id)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_ontology_rhythm_goal_role(
  target_goal_id UUID,
  next_role TEXT
)
RETURNS public.ontology_rhythm_goals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_goal public.ontology_rhythm_goals;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in';
  END IF;
  IF next_role NOT IN ('major', 'minor', 'unassigned') THEN
    RAISE EXCEPTION 'Invalid rhythm goal role';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ontology_rhythm_goals
    WHERE id = target_goal_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You cannot update this rhythm goal';
  END IF;

  IF next_role IN ('major', 'minor') THEN
    UPDATE public.ontology_rhythm_goals
    SET role = 'unassigned', updated_at = timezone('utc'::text, now())
    WHERE user_id = auth.uid()
      AND id <> target_goal_id
      AND role = next_role
      AND status = 'active';
  END IF;

  UPDATE public.ontology_rhythm_goals
  SET role = next_role, updated_at = timezone('utc'::text, now())
  WHERE id = target_goal_id AND user_id = auth.uid()
  RETURNING * INTO updated_goal;

  RETURN updated_goal;
END;
$$;

CREATE OR REPLACE FUNCTION public.write_ontology_action_log(
  next_action TEXT,
  next_object_type TEXT,
  next_object_id TEXT,
  next_source TEXT,
  next_before_state JSONB DEFAULT NULL,
  next_after_state JSONB DEFAULT NULL,
  next_metadata JSONB DEFAULT '{}'::jsonb,
  next_workspace_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  log_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in';
  END IF;
  IF next_source NOT IN ('web', 'line', 'agent', 'database', 'system') THEN
    RAISE EXCEPTION 'Invalid action source';
  END IF;
  IF next_workspace_id IS NOT NULL AND NOT public.is_shared_workspace_member(next_workspace_id) THEN
    RAISE EXCEPTION 'You are not a member of this workspace';
  END IF;

  INSERT INTO public.ontology_action_logs (
    actor_user_id, workspace_id, action, object_type, object_id, source,
    before_state, after_state, metadata
  ) VALUES (
    auth.uid(), next_workspace_id, next_action, next_object_type,
    next_object_id, next_source, next_before_state, next_after_state,
    COALESCE(next_metadata, '{}'::jsonb)
  ) RETURNING id INTO log_id;

  RETURN log_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.owns_ontology_subject(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.owns_ontology_group(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.replace_ontology_group_subjects(UUID, UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_ontology_rhythm_goal_role(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.write_ontology_action_log(TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owns_ontology_subject(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_ontology_group(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_ontology_group_subjects(UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_ontology_rhythm_goal_role(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_ontology_action_log(TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB, UUID) TO authenticated;

DROP POLICY IF EXISTS "Users manage their own ontology subjects" ON public.ontology_subjects;
CREATE POLICY "Users manage their own ontology subjects" ON public.ontology_subjects
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users manage their own ontology groups" ON public.ontology_subject_groups;
CREATE POLICY "Users manage their own ontology groups" ON public.ontology_subject_groups
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users manage members of their ontology groups" ON public.ontology_subject_group_members;
CREATE POLICY "Users manage members of their ontology groups" ON public.ontology_subject_group_members
  FOR ALL
  USING (public.owns_ontology_group(group_id) AND public.owns_ontology_subject(subject_id))
  WITH CHECK (public.owns_ontology_group(group_id) AND public.owns_ontology_subject(subject_id));

DROP POLICY IF EXISTS "Users manage their own rhythm goals" ON public.ontology_rhythm_goals;
CREATE POLICY "Users manage their own rhythm goals" ON public.ontology_rhythm_goals
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users manage their own maintenance practices" ON public.ontology_maintenance_practices;
CREATE POLICY "Users manage their own maintenance practices" ON public.ontology_maintenance_practices
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users view their ontology action logs" ON public.ontology_action_logs;
CREATE POLICY "Users view their ontology action logs" ON public.ontology_action_logs
  FOR SELECT USING (
    actor_user_id = auth.uid()
    OR (workspace_id IS NOT NULL AND public.is_shared_workspace_member(workspace_id))
  );

-- Direct inserts are deliberately denied to browser clients. Future Koko
-- actions and triggers write logs in a controlled server/database context.
DROP POLICY IF EXISTS "No client writes to ontology action logs" ON public.ontology_action_logs;
CREATE POLICY "No client writes to ontology action logs" ON public.ontology_action_logs
  FOR INSERT WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.log_planner_ontology_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_before JSONB;
  row_after JSONB;
  target_id TEXT;
  target_workspace_id UUID;
  target_user_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_before := to_jsonb(OLD);
    row_after := NULL;
    target_id := OLD.id::text;
    target_workspace_id := OLD.workspace_id;
    target_user_id := COALESCE(auth.uid(), OLD.user_id);
  ELSIF TG_OP = 'INSERT' THEN
    row_before := NULL;
    row_after := to_jsonb(NEW);
    target_id := NEW.id::text;
    target_workspace_id := NEW.workspace_id;
    target_user_id := COALESCE(auth.uid(), NEW.user_id);
  ELSE
    row_before := to_jsonb(OLD);
    row_after := to_jsonb(NEW);
    target_id := NEW.id::text;
    target_workspace_id := NEW.workspace_id;
    target_user_id := COALESCE(auth.uid(), NEW.user_id);
  END IF;

  INSERT INTO public.ontology_action_logs (
    actor_user_id, workspace_id, action, object_type, object_id,
    before_state, after_state
  ) VALUES (
    target_user_id,
    target_workspace_id,
    lower(TG_OP),
    TG_TABLE_NAME,
    target_id,
    row_before,
    row_after
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS ontology_audit_planner_tasks ON public.planner_tasks;
CREATE TRIGGER ontology_audit_planner_tasks
  AFTER INSERT OR UPDATE OR DELETE ON public.planner_tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_planner_ontology_change();

DROP TRIGGER IF EXISTS ontology_audit_planner_events ON public.planner_events;
CREATE TRIGGER ontology_audit_planner_events
  AFTER INSERT OR UPDATE OR DELETE ON public.planner_events
  FOR EACH ROW EXECUTE FUNCTION public.log_planner_ontology_change();

CREATE INDEX IF NOT EXISTS idx_ontology_subjects_user_name ON public.ontology_subjects(user_id, name);
CREATE INDEX IF NOT EXISTS idx_ontology_groups_user_name ON public.ontology_subject_groups(user_id, name);
CREATE INDEX IF NOT EXISTS idx_ontology_group_members_subject ON public.ontology_subject_group_members(subject_id);
CREATE INDEX IF NOT EXISTS idx_ontology_rhythm_goals_user_status ON public.ontology_rhythm_goals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_ontology_maintenance_user_active ON public.ontology_maintenance_practices(user_id, active);
CREATE INDEX IF NOT EXISTS idx_ontology_action_logs_actor_created ON public.ontology_action_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ontology_action_logs_workspace_created ON public.ontology_action_logs(workspace_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
