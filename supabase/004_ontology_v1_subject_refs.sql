-- =============================================================================
-- KOKO ONTOLOGY V1 — CANONICAL SUBJECT REFERENCES
-- =============================================================================
-- Migration 004. Run after `003_ontology_v0.sql`.
-- This is additive: the existing text `subject` columns remain the display
-- and backwards-compatibility layer while new writes may include subject_id.

ALTER TABLE public.planner_tasks
  ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.ontology_subjects(id) ON DELETE SET NULL;

ALTER TABLE public.study_sessions
  ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.ontology_subjects(id) ON DELETE SET NULL;

ALTER TABLE public.study_intervals
  ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.ontology_subjects(id) ON DELETE SET NULL;

-- Backfill canonical subjects and references from existing personal records.
-- This is idempotent and deliberately preserves the original text value.
INSERT INTO public.ontology_subjects (user_id, name)
SELECT DISTINCT source.user_id, source.name
FROM (
  SELECT user_id, btrim(subject) AS name FROM public.planner_tasks WHERE btrim(COALESCE(subject, '')) <> ''
  UNION
  SELECT user_id, btrim(subject) AS name FROM public.study_sessions WHERE btrim(COALESCE(subject, '')) <> ''
  UNION
  SELECT user_id, btrim(subject) AS name FROM public.study_intervals WHERE btrim(COALESCE(subject, '')) <> ''
) AS source
ON CONFLICT (user_id, name) DO NOTHING;

UPDATE public.planner_tasks AS task
SET subject_id = subject.id
FROM public.ontology_subjects AS subject
WHERE task.subject_id IS NULL
  AND subject.user_id = task.user_id
  AND subject.name = btrim(task.subject);

UPDATE public.study_sessions AS session
SET subject_id = subject.id
FROM public.ontology_subjects AS subject
WHERE session.subject_id IS NULL
  AND subject.user_id = session.user_id
  AND subject.name = btrim(session.subject);

UPDATE public.study_intervals AS interval
SET subject_id = subject.id
FROM public.ontology_subjects AS subject
WHERE interval.subject_id IS NULL
  AND subject.user_id = interval.user_id
  AND subject.name = btrim(interval.subject);

CREATE INDEX IF NOT EXISTS idx_planner_tasks_subject_id ON public.planner_tasks(subject_id);
CREATE INDEX IF NOT EXISTS idx_study_sessions_subject_id ON public.study_sessions(subject_id);
CREATE INDEX IF NOT EXISTS idx_study_intervals_subject_id ON public.study_intervals(subject_id);

-- A signed-in learner may only attach records to their own canonical subject.
-- Existing RLS policies still protect the record itself; these triggers add the
-- relation-level ownership check without changing old text-subject data.
CREATE OR REPLACE FUNCTION public.assert_owned_ontology_subject_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.subject_id IS NOT NULL AND NOT public.owns_ontology_subject(NEW.subject_id) THEN
    RAISE EXCEPTION 'The linked subject must belong to you';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS planner_tasks_subject_reference_guard ON public.planner_tasks;
CREATE TRIGGER planner_tasks_subject_reference_guard
  BEFORE INSERT OR UPDATE OF subject_id ON public.planner_tasks
  FOR EACH ROW EXECUTE FUNCTION public.assert_owned_ontology_subject_reference();

DROP TRIGGER IF EXISTS study_sessions_subject_reference_guard ON public.study_sessions;
CREATE TRIGGER study_sessions_subject_reference_guard
  BEFORE INSERT OR UPDATE OF subject_id ON public.study_sessions
  FOR EACH ROW EXECUTE FUNCTION public.assert_owned_ontology_subject_reference();

DROP TRIGGER IF EXISTS study_intervals_subject_reference_guard ON public.study_intervals;
CREATE TRIGGER study_intervals_subject_reference_guard
  BEFORE INSERT OR UPDATE OF subject_id ON public.study_intervals
  FOR EACH ROW EXECUTE FUNCTION public.assert_owned_ontology_subject_reference();

REVOKE EXECUTE ON FUNCTION public.assert_owned_ontology_subject_reference() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
