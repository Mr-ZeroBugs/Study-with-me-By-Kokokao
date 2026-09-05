-- =============================================================================
-- KOKO PERSONAL ONTOLOGY SNAPSHOT V1
-- =============================================================================
-- Migration 008. Run after 001_schema.sql, 003_ontology_v0.sql,
-- 004_ontology_v1_subject_refs.sql, 006_adaptive_planner_v0.sql,
-- and 007_personal_memory_v0.sql.
--
-- Canonical tables remain the source of truth. This stores a compiled,
-- versioned read model so every Koko surface can understand one account with
-- the same object/link/policy template. Previous revisions are retained as a
-- recoverable account-scoped history.

CREATE TABLE IF NOT EXISTS public.user_ontology_snapshots (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  schema_version TEXT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  content_hash TEXT NOT NULL CHECK (char_length(content_hash) BETWEEN 16 AND 128),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.user_ontology_snapshot_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  schema_version TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK (revision > 0),
  content_hash TEXT NOT NULL,
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  generated_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (user_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_user_ontology_snapshot_history_latest
  ON public.user_ontology_snapshot_history(user_id, revision DESC);

ALTER TABLE public.user_ontology_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ontology_snapshot_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view their current ontology snapshot" ON public.user_ontology_snapshots;
CREATE POLICY "Users view their current ontology snapshot"
  ON public.user_ontology_snapshots FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users view their ontology snapshot history" ON public.user_ontology_snapshot_history;
CREATE POLICY "Users view their ontology snapshot history"
  ON public.user_ontology_snapshot_history FOR SELECT
  USING (user_id = auth.uid());

-- Snapshot writes are server-managed. Browser and model output never become
-- the source of truth; they can only read the compiled representation.
DROP POLICY IF EXISTS "No client writes current ontology snapshots" ON public.user_ontology_snapshots;
CREATE POLICY "No client writes current ontology snapshots"
  ON public.user_ontology_snapshots FOR ALL
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "No client writes ontology snapshot history" ON public.user_ontology_snapshot_history;
CREATE POLICY "No client writes ontology snapshot history"
  ON public.user_ontology_snapshot_history FOR ALL
  USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.archive_previous_ontology_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.content_hash = OLD.content_hash AND NEW.schema_version = OLD.schema_version THEN
    NEW.revision := OLD.revision;
    NEW.generated_at := OLD.generated_at;
    NEW.updated_at := timezone('utc'::text, now());
    RETURN NEW;
  END IF;

  INSERT INTO public.user_ontology_snapshot_history (
    user_id, schema_version, revision, content_hash, snapshot, generated_at
  ) VALUES (
    OLD.user_id, OLD.schema_version, OLD.revision, OLD.content_hash, OLD.snapshot, OLD.generated_at
  ) ON CONFLICT (user_id, revision) DO NOTHING;

  NEW.revision := OLD.revision + 1;
  NEW.updated_at := timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS archive_previous_ontology_snapshot ON public.user_ontology_snapshots;
CREATE TRIGGER archive_previous_ontology_snapshot
  BEFORE UPDATE ON public.user_ontology_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.archive_previous_ontology_snapshot();

REVOKE EXECUTE ON FUNCTION public.archive_previous_ontology_snapshot() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
