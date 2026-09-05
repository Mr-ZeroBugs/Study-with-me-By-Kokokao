-- KOKO SILENT TASK INTELLIGENCE V0
-- Migration 005. Run after 001_schema.sql. These are metadata columns only: task ownership and
-- existing behavior remain unchanged, and all are nullable for safe rollout.

ALTER TABLE public.planner_tasks
  ADD COLUMN IF NOT EXISTS normalized_title TEXT,
  ADD COLUMN IF NOT EXISTS subject_key TEXT,
  ADD COLUMN IF NOT EXISTS deadline_confidence TEXT CHECK (deadline_confidence IN ('explicit', 'inferred', 'none'));

CREATE INDEX IF NOT EXISTS idx_planner_tasks_dedupe_lookup
  ON public.planner_tasks (user_id, normalized_title, subject_key, due_date)
  WHERE completed = FALSE;

NOTIFY pgrst, 'reload schema';
