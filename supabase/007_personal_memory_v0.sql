-- =============================================================================
-- KOKO PERSONAL MEMORY V0
-- =============================================================================
-- Migration 007. Run after 001_schema.sql and 003_ontology_v0.sql. This intentionally stores only
-- compact, user-scoped facts; it is not a chat transcript or Team Space log.

CREATE TABLE IF NOT EXISTS public.user_memory_settings (
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  write_approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_memory_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('preference', 'learning')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'rejected', 'archived')),
  content TEXT NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 360),
  content_key TEXT NOT NULL CHECK (char_length(content_key) BETWEEN 1 AND 64),
  source TEXT NOT NULL DEFAULT 'agent' CHECK (source IN ('web', 'line', 'agent', 'system')),
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  UNIQUE (user_id, content_key)
);

CREATE INDEX IF NOT EXISTS idx_user_memory_active ON public.user_memory_items(user_id, status, updated_at DESC);

ALTER TABLE public.user_memory_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_memory_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own memory settings" ON public.user_memory_settings;
CREATE POLICY "Users manage their own memory settings" ON public.user_memory_settings
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users manage their own memory items" ON public.user_memory_items;
CREATE POLICY "Users manage their own memory items" ON public.user_memory_items
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- The memory table must never become a covert Team Space channel. It has no
-- workspace_id and no policy permitting another member to read it.
NOTIFY pgrst, 'reload schema';
