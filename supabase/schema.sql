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
  target_date DATE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

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
