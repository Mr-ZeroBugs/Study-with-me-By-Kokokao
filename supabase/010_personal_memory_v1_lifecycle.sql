-- KOKO PERSONAL MEMORY V1 — LIFECYCLE + OBSERVATION SAFETY
-- Migration 010. Run after 007_personal_memory_v0.sql. Existing memories remain explicit.

ALTER TABLE public.user_memory_items
  ADD COLUMN IF NOT EXISTS memory_type TEXT NOT NULL DEFAULT 'explicit',
  ADD COLUMN IF NOT EXISTS evidence TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE public.user_memory_items
  DROP CONSTRAINT IF EXISTS user_memory_items_memory_type_check;
ALTER TABLE public.user_memory_items
  ADD CONSTRAINT user_memory_items_memory_type_check
  CHECK (memory_type IN ('explicit', 'observed', 'temporary', 'sensitive'));

-- Sensitive memory is deliberately never activated. The application rejects it
-- before insert, and this protects the invariant if a future client bypasses it.
ALTER TABLE public.user_memory_items
  DROP CONSTRAINT IF EXISTS user_memory_items_sensitive_not_active;
ALTER TABLE public.user_memory_items
  ADD CONSTRAINT user_memory_items_sensitive_not_active
  CHECK (memory_type <> 'sensitive' OR status <> 'active');

CREATE INDEX IF NOT EXISTS idx_user_memory_lifecycle
  ON public.user_memory_items (user_id, status, memory_type, expires_at);

NOTIFY pgrst, 'reload schema';
