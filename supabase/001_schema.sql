-- ==============================================================================
-- STUDY TIMER PRODUCTION DATABASE SCHEMA (SUPABASE)
-- ==============================================================================

-- 1. Create PROFILES table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create DAILY_LOGS table (Aggregated daily focus minutes & rounds for calendar)
CREATE TABLE IF NOT EXISTS public.daily_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date_key TEXT NOT NULL, -- Format: YYYY-MM-DD
  total_minutes INTEGER NOT NULL DEFAULT 0,
  rounds INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id, date_key)
);

-- 3. Create STUDY_SESSIONS table (Detailed history of focus / break intervals)
CREATE TABLE IF NOT EXISTS public.study_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  timer_mode TEXT NOT NULL, -- 'flow' or 'countdown'
  mode TEXT NOT NULL, -- 'focus', 'short', 'long'
  subject TEXT NOT NULL DEFAULT 'General', -- User-created study subject
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  date_key TEXT NOT NULL, -- Format: YYYY-MM-DD
  completed_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Safe migration for projects created before subject tracking was added.
ALTER TABLE public.study_sessions
  ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT 'General';

-- 3b. Create STUDY_INTERVALS table (Continuous start/stop segments for timeline analytics)
CREATE TABLE IF NOT EXISTS public.study_intervals (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  timer_mode TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'focus',
  subject TEXT NOT NULL DEFAULT 'General',
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Planning hub: concrete tasks, long-term goals, and important dates
CREATE TABLE IF NOT EXISTS public.planner_tasks (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'General',
  due_date DATE,
  estimated_minutes INTEGER NOT NULL DEFAULT 25,
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.life_goals (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  subjects TEXT[] NOT NULL DEFAULT '{}',
  shelf_position INTEGER,
  target_date DATE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Safe migration for goals created before subject playlists were added.
ALTER TABLE public.life_goals
  ADD COLUMN IF NOT EXISTS subjects TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.life_goals
  ADD COLUMN IF NOT EXISTS shelf_position INTEGER;

CREATE TABLE IF NOT EXISTS public.goal_steps (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  goal_id UUID REFERENCES public.life_goals(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  due_date DATE,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.planner_events (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  event_date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('competition', 'project', 'exam', 'important')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Enable Row Level Security (RLS) on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planner_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.life_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planner_events ENABLE ROW LEVEL SECURITY;

-- 5. Profiles RLS Policies
-- Drop/recreate makes this script safe to run again after a migration.
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- 6. Daily Logs RLS Policies
DROP POLICY IF EXISTS "Users can view their own daily logs" ON public.daily_logs;
DROP POLICY IF EXISTS "Users can insert their own daily logs" ON public.daily_logs;
DROP POLICY IF EXISTS "Users can update their own daily logs" ON public.daily_logs;
DROP POLICY IF EXISTS "Users can delete their own daily logs" ON public.daily_logs;

CREATE POLICY "Users can view their own daily logs"
  ON public.daily_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own daily logs"
  ON public.daily_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own daily logs"
  ON public.daily_logs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own daily logs"
  ON public.daily_logs FOR DELETE
  USING (auth.uid() = user_id);

-- 7. Study Sessions RLS Policies
DROP POLICY IF EXISTS "Users can view their own study sessions" ON public.study_sessions;
DROP POLICY IF EXISTS "Users can insert their own study sessions" ON public.study_sessions;
DROP POLICY IF EXISTS "Users can delete their own study sessions" ON public.study_sessions;

CREATE POLICY "Users can view their own study sessions"
  ON public.study_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own study sessions"
  ON public.study_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own study sessions"
  ON public.study_sessions FOR DELETE
  USING (auth.uid() = user_id);

-- 7b. Study interval RLS policies
DROP POLICY IF EXISTS "Users can view their own study intervals" ON public.study_intervals;
DROP POLICY IF EXISTS "Users can insert their own study intervals" ON public.study_intervals;
DROP POLICY IF EXISTS "Users can delete their own study intervals" ON public.study_intervals;

CREATE POLICY "Users can view their own study intervals"
  ON public.study_intervals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own study intervals"
  ON public.study_intervals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own study intervals"
  ON public.study_intervals FOR DELETE
  USING (auth.uid() = user_id);

-- 8. Planning hub RLS Policies
DROP POLICY IF EXISTS "Users can manage their own planner tasks" ON public.planner_tasks;
CREATE POLICY "Users can manage their own planner tasks" ON public.planner_tasks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own life goals" ON public.life_goals;
CREATE POLICY "Users can manage their own life goals" ON public.life_goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own goal steps" ON public.goal_steps;
CREATE POLICY "Users can manage their own goal steps" ON public.goal_steps
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own planner events" ON public.planner_events;
CREATE POLICY "Users can manage their own planner events" ON public.planner_events
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 9. Trigger to automatically create a Profile entry on auth user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_daily_logs_user_date ON public.daily_logs(user_id, date_key);
CREATE INDEX IF NOT EXISTS idx_study_sessions_user_date ON public.study_sessions(user_id, date_key);
CREATE INDEX IF NOT EXISTS idx_study_intervals_user_start ON public.study_intervals(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_planner_tasks_user_due ON public.planner_tasks(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_life_goals_user_target ON public.life_goals(user_id, target_date);
CREATE INDEX IF NOT EXISTS idx_goal_steps_goal ON public.goal_steps(goal_id, order_index);
CREATE INDEX IF NOT EXISTS idx_planner_events_user_date ON public.planner_events(user_id, event_date);

-- 10. Shared planner spaces (tasks and important dates can be shared with friends)
CREATE TABLE IF NOT EXISTS public.shared_workspaces (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 60),
  invite_code TEXT NOT NULL UNIQUE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.shared_workspace_members (
  workspace_id UUID REFERENCES public.shared_workspaces(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE public.planner_tasks
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.shared_workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.planner_events
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.shared_workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.shared_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_workspace_members ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_workspaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_workspace_members TO authenticated;

-- Security-definer helpers avoid recursive RLS checks when a policy verifies
-- that the current user belongs to a workspace.
CREATE OR REPLACE FUNCTION public.is_shared_workspace_member(target_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shared_workspace_members
    WHERE workspace_id = target_workspace_id
      AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_shared_workspace_owner(target_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shared_workspaces
    WHERE id = target_workspace_id
      AND owner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.list_shared_workspace_members(target_workspace_id UUID)
RETURNS TABLE (user_id UUID, role TEXT, created_at TIMESTAMPTZ, display_name TEXT, email TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_shared_workspace_member(target_workspace_id) THEN
    RAISE EXCEPTION 'You are not a member of this shared space';
  END IF;

  RETURN QUERY
  SELECT members.user_id,
    members.role,
    members.created_at,
    COALESCE(NULLIF(trim(profiles.display_name), ''), NULLIF(trim(profiles.email), ''), 'member'),
    COALESCE(profiles.email, '')
  FROM public.shared_workspace_members AS members
  LEFT JOIN public.profiles AS profiles ON profiles.id = members.user_id
  WHERE members.workspace_id = target_workspace_id
  ORDER BY members.role DESC, members.created_at ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_shared_workspace_member(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_shared_workspace_owner(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_shared_workspace_members(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_shared_workspace_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_shared_workspace_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_shared_workspace_members(UUID) TO authenticated;

DROP POLICY IF EXISTS "Members can view shared workspaces" ON public.shared_workspaces;
CREATE POLICY "Members can view shared workspaces"
  ON public.shared_workspaces FOR SELECT
  USING (owner_id = auth.uid() OR public.is_shared_workspace_member(id));

DROP POLICY IF EXISTS "Users can create shared workspaces" ON public.shared_workspaces;
CREATE POLICY "Users can create shared workspaces"
  ON public.shared_workspaces FOR INSERT
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners can update shared workspaces" ON public.shared_workspaces;
CREATE POLICY "Owners can update shared workspaces"
  ON public.shared_workspaces FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners can delete shared workspaces" ON public.shared_workspaces;
CREATE POLICY "Owners can delete shared workspaces"
  ON public.shared_workspaces FOR DELETE
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Members can view workspace members" ON public.shared_workspace_members;
CREATE POLICY "Members can view workspace members"
  ON public.shared_workspace_members FOR SELECT
  USING (public.is_shared_workspace_member(workspace_id));

DROP POLICY IF EXISTS "Users can leave shared workspaces" ON public.shared_workspace_members;
CREATE POLICY "Users can leave shared workspaces"
  ON public.shared_workspace_members FOR DELETE
  USING (user_id = auth.uid() AND role <> 'owner');

-- Members can see lightweight identity details for people in their shared
-- spaces. This is intentionally limited to profiles that share a workspace.
DROP POLICY IF EXISTS "Members can view profiles in shared spaces" ON public.profiles;
CREATE POLICY "Members can view profiles in shared spaces"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1
      FROM public.shared_workspace_members AS members
      WHERE members.user_id = profiles.id
        AND public.is_shared_workspace_member(members.workspace_id)
    )
  );

-- Members can work on shared rows while personal rows remain private.
DROP POLICY IF EXISTS "Users can manage their own planner tasks" ON public.planner_tasks;
CREATE POLICY "Users can manage their own planner tasks" ON public.planner_tasks
  FOR ALL
  USING (
    (workspace_id IS NULL AND auth.uid() = user_id)
    OR (workspace_id IS NOT NULL AND public.is_shared_workspace_member(workspace_id))
  )
  WITH CHECK (
    (workspace_id IS NULL AND auth.uid() = user_id)
    OR (workspace_id IS NOT NULL AND public.is_shared_workspace_member(workspace_id))
  );

DROP POLICY IF EXISTS "Users can manage their own planner events" ON public.planner_events;
CREATE POLICY "Users can manage their own planner events" ON public.planner_events
  FOR ALL
  USING (
    (workspace_id IS NULL AND auth.uid() = user_id)
    OR (workspace_id IS NOT NULL AND public.is_shared_workspace_member(workspace_id))
  )
  WITH CHECK (
    (workspace_id IS NULL AND auth.uid() = user_id)
    OR (workspace_id IS NOT NULL AND public.is_shared_workspace_member(workspace_id))
  );

CREATE INDEX IF NOT EXISTS idx_planner_tasks_workspace_due ON public.planner_tasks(workspace_id, due_date);
CREATE INDEX IF NOT EXISTS idx_planner_events_workspace_date ON public.planner_events(workspace_id, event_date);
CREATE INDEX IF NOT EXISTS idx_shared_workspace_members_user ON public.shared_workspace_members(user_id);

CREATE OR REPLACE FUNCTION public.create_shared_workspace(workspace_name TEXT)
RETURNS SETOF public.shared_workspaces
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_workspace public.shared_workspaces;
  generated_code TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to create a shared space';
  END IF;
  IF char_length(trim(workspace_name)) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'Workspace name must be between 1 and 60 characters';
  END IF;

  LOOP
    generated_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.shared_workspaces WHERE invite_code = generated_code);
  END LOOP;

  INSERT INTO public.shared_workspaces (name, invite_code, owner_id)
  VALUES (trim(workspace_name), generated_code, auth.uid())
  RETURNING * INTO new_workspace;

  INSERT INTO public.shared_workspace_members (workspace_id, user_id, role)
  VALUES (new_workspace.id, auth.uid(), 'owner');

  RETURN NEXT new_workspace;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_shared_workspace(invite_code_input TEXT)
RETURNS SETOF public.shared_workspaces
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_workspace public.shared_workspaces;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to join a shared space';
  END IF;

  SELECT * INTO target_workspace
  FROM public.shared_workspaces
  WHERE invite_code = upper(trim(invite_code_input));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite code not found';
  END IF;

  INSERT INTO public.shared_workspace_members (workspace_id, user_id, role)
  VALUES (target_workspace.id, auth.uid(), 'member')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  RETURN NEXT target_workspace;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_shared_workspace(target_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_shared_workspace_member(target_workspace_id) THEN
    RAISE EXCEPTION 'You are not a member of this shared space';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.shared_workspace_members
    WHERE workspace_id = target_workspace_id AND user_id = auth.uid() AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'The owner cannot leave. Delete the shared space instead.';
  END IF;

  DELETE FROM public.shared_workspace_members
  WHERE workspace_id = target_workspace_id AND user_id = auth.uid();
  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_shared_workspace(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.join_shared_workspace(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.leave_shared_workspace(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_shared_workspace(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_shared_workspace(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_shared_workspace(UUID) TO authenticated;

-- Make newly-created RPCs visible immediately to the PostgREST API.
NOTIFY pgrst, 'reload schema';
