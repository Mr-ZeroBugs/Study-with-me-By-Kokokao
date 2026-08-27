-- ==============================================================================
-- LINE MESSAGING API INTEGRATION SCHEMA
-- ==============================================================================

-- 1. Create table for linking Supabase Auth users to their LINE user IDs
CREATE TABLE IF NOT EXISTS public.user_line_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  line_user_id TEXT UNIQUE,
  link_code TEXT,
  link_code_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_user_line_connections_user ON public.user_line_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_user_line_connections_line_user ON public.user_line_connections(line_user_id);
CREATE INDEX IF NOT EXISTS idx_user_line_connections_code ON public.user_line_connections(link_code);

-- 3. Enable RLS
ALTER TABLE public.user_line_connections ENABLE ROW LEVEL SECURITY;

-- 4. Policies
DROP POLICY IF EXISTS "Users can view and manage their own LINE connection" ON public.user_line_connections;
CREATE POLICY "Users can view and manage their own LINE connection"
  ON public.user_line_connections
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
