-- =============================================================================
-- KOKO RHYTHM BULK SYNC
-- =============================================================================
-- Migration 013. Run after 012_account_app_state.sql.
--
-- The previous client bridge saved one subject/group/membership at a time.
-- This RPC receives one complete plan and applies it atomically, preventing a
-- refresh from ever reading a partially-saved Rhythm graph.

CREATE OR REPLACE FUNCTION public.sync_ontology_rhythm_plan(next_plan JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  group_item JSONB;
  subject_item JSONB;
  maintenance_item JSONB;
  local_group_id TEXT;
  target_group_id UUID;
  group_name TEXT;
  target_subject_id UUID;
  subject_name TEXT;
  minutes_per_day INTEGER;
  major_group_id UUID;
  minor_group_id UUID;
  role_name TEXT;
  role_group_id UUID;
  role_goal_id UUID;
  kept_group_ids UUID[] := ARRAY[]::UUID[];
  kept_maintenance_subject_ids UUID[] := ARRAY[]::UUID[];
  group_id_map JSONB := '{}'::JSONB;
  result_groups JSONB := '[]'::JSONB;
  result_maintenance JSONB := '[]'::JSONB;
  result_major TEXT := '';
  result_minor TEXT := '';
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in';
  END IF;
  IF jsonb_typeof(next_plan) <> 'object'
    OR jsonb_typeof(next_plan->'groups') <> 'array'
    OR jsonb_array_length(next_plan->'groups') = 0 THEN
    RAISE EXCEPTION 'A Rhythm plan needs at least one group';
  END IF;

  FOR group_item IN SELECT value FROM jsonb_array_elements(next_plan->'groups')
  LOOP
    local_group_id := COALESCE(group_item->>'id', '');
    group_name := left(btrim(COALESCE(group_item->>'name', '')), 80);
    IF group_name = '' THEN
      RAISE EXCEPTION 'Each Rhythm group needs a name';
    END IF;
    target_group_id := NULL;

    IF local_group_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      SELECT id INTO target_group_id
      FROM public.ontology_subject_groups
      WHERE id = local_group_id::UUID AND user_id = actor_id AND archived_at IS NULL;
    END IF;
    IF target_group_id IS NULL THEN
      SELECT id INTO target_group_id
      FROM public.ontology_subject_groups
      WHERE user_id = actor_id
        AND archived_at IS NULL
        AND lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = lower(regexp_replace(group_name, '\s+', ' ', 'g'))
      ORDER BY created_at
      LIMIT 1;
    END IF;
    IF target_group_id IS NULL THEN
      INSERT INTO public.ontology_subject_groups (user_id, name)
      VALUES (actor_id, group_name)
      RETURNING id INTO target_group_id;
    ELSIF EXISTS (
      SELECT 1 FROM public.ontology_subject_groups
      WHERE id = target_group_id AND name <> group_name
    ) THEN
      UPDATE public.ontology_subject_groups
      SET name = group_name, updated_at = timezone('utc'::text, now())
      WHERE id = target_group_id;
    END IF;

    kept_group_ids := array_append(kept_group_ids, target_group_id);
    group_id_map := group_id_map || jsonb_build_object(local_group_id, target_group_id::TEXT);

    -- Memberships are replaced as one coherent set for each group. Subject
    -- identities are resolved case/spacing-insensitively for older records.
    DELETE FROM public.ontology_subject_group_members AS membership_row WHERE membership_row.group_id = target_group_id;
    IF jsonb_typeof(group_item->'subjects') = 'array' THEN
      FOR subject_item IN SELECT value FROM jsonb_array_elements(group_item->'subjects')
      LOOP
        subject_name := left(btrim(COALESCE(subject_item->>'name', '')), 80);
        IF subject_name = '' THEN CONTINUE; END IF;
        target_subject_id := NULL;
        IF COALESCE(subject_item->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
          SELECT id INTO target_subject_id
          FROM public.ontology_subjects
          WHERE id = (subject_item->>'id')::UUID AND user_id = actor_id AND archived_at IS NULL;
        END IF;
        IF target_subject_id IS NULL THEN
          SELECT id INTO target_subject_id
          FROM public.ontology_subjects
          WHERE user_id = actor_id
            AND archived_at IS NULL
            AND lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = lower(regexp_replace(subject_name, '\s+', ' ', 'g'))
          ORDER BY created_at
          LIMIT 1;
        END IF;
        IF target_subject_id IS NULL THEN
          INSERT INTO public.ontology_subjects (user_id, name)
          VALUES (actor_id, subject_name)
          RETURNING id INTO target_subject_id;
        END IF;
        INSERT INTO public.ontology_subject_group_members (group_id, subject_id)
        VALUES (target_group_id, target_subject_id)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;
  END LOOP;

  -- A removed group must not resurrect on the next cloud hydration.
  UPDATE public.ontology_subject_groups
  SET archived_at = timezone('utc'::text, now()), updated_at = timezone('utc'::text, now())
  WHERE user_id = actor_id
    AND archived_at IS NULL
    AND NOT (id = ANY(kept_group_ids));
  UPDATE public.ontology_rhythm_goals
  SET role = 'unassigned', status = 'archived', updated_at = timezone('utc'::text, now())
  WHERE user_id = actor_id
    AND status = 'active'
    AND subject_group_id IS NOT NULL
    AND NOT (subject_group_id = ANY(kept_group_ids));

  IF COALESCE(next_plan->>'majorGroupId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    major_group_id := (next_plan->>'majorGroupId')::UUID;
  ELSE
    major_group_id := NULLIF(group_id_map->>COALESCE(next_plan->>'majorGroupId', ''), '')::UUID;
  END IF;
  IF COALESCE(next_plan->>'minorGroupId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    minor_group_id := (next_plan->>'minorGroupId')::UUID;
  ELSE
    minor_group_id := NULLIF(group_id_map->>COALESCE(next_plan->>'minorGroupId', ''), '')::UUID;
  END IF;
  IF major_group_id IS NOT NULL AND NOT (major_group_id = ANY(kept_group_ids)) THEN major_group_id := NULL; END IF;
  IF minor_group_id IS NOT NULL AND NOT (minor_group_id = ANY(kept_group_ids)) THEN minor_group_id := NULL; END IF;
  IF major_group_id = minor_group_id THEN minor_group_id := NULL; END IF;

  UPDATE public.ontology_rhythm_goals
  SET role = 'unassigned', updated_at = timezone('utc'::text, now())
  WHERE user_id = actor_id AND status = 'active' AND role IN ('major', 'minor');
  FOR role_name, role_group_id IN
    SELECT * FROM (VALUES ('major'::TEXT, major_group_id), ('minor'::TEXT, minor_group_id)) AS roles(name, group_id)
  LOOP
    IF role_group_id IS NULL THEN CONTINUE; END IF;
    SELECT id INTO role_goal_id
    FROM public.ontology_rhythm_goals
    WHERE user_id = actor_id AND subject_group_id = role_group_id AND status = 'active'
    ORDER BY created_at
    LIMIT 1;
    IF role_goal_id IS NULL THEN
      SELECT name INTO group_name FROM public.ontology_subject_groups WHERE id = role_group_id;
      INSERT INTO public.ontology_rhythm_goals (user_id, title, subject_group_id, role)
      VALUES (actor_id, COALESCE(group_name, 'Rhythm goal'), role_group_id, role_name);
    ELSE
      UPDATE public.ontology_rhythm_goals
      SET role = role_name, updated_at = timezone('utc'::text, now())
      WHERE id = role_goal_id;
    END IF;
  END LOOP;

  IF jsonb_typeof(next_plan->'maintenance') = 'array' THEN
    FOR maintenance_item IN SELECT value FROM jsonb_array_elements(next_plan->'maintenance')
    LOOP
      subject_name := left(btrim(COALESCE(maintenance_item->>'subjectName', '')), 80);
      IF COALESCE(maintenance_item->>'minutes', '') !~ '^\d+$' THEN CONTINUE; END IF;
      minutes_per_day := (maintenance_item->>'minutes')::INTEGER;
      IF subject_name = '' OR minutes_per_day NOT IN (5, 10, 15, 20) THEN CONTINUE; END IF;
      SELECT id INTO target_subject_id
      FROM public.ontology_subjects
      WHERE user_id = actor_id
        AND archived_at IS NULL
        AND lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = lower(regexp_replace(subject_name, '\s+', ' ', 'g'))
      ORDER BY created_at
      LIMIT 1;
      IF target_subject_id IS NULL THEN CONTINUE; END IF;
      kept_maintenance_subject_ids := array_append(kept_maintenance_subject_ids, target_subject_id);
      INSERT INTO public.ontology_maintenance_practices (user_id, subject_id, minutes_per_day, active)
      VALUES (actor_id, target_subject_id, minutes_per_day, TRUE)
      ON CONFLICT (user_id, subject_id) DO UPDATE
      SET minutes_per_day = EXCLUDED.minutes_per_day, active = TRUE, updated_at = timezone('utc'::text, now());
    END LOOP;
  END IF;
  UPDATE public.ontology_maintenance_practices
  SET active = FALSE, updated_at = timezone('utc'::text, now())
  WHERE user_id = actor_id
    AND active = TRUE
    AND NOT (subject_id = ANY(kept_maintenance_subject_ids));

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', group_row.id::TEXT,
      'name', group_row.name,
      'subjects', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', subject_row.id::TEXT, 'name', subject_row.name) ORDER BY subject_row.name)
        FROM public.ontology_subject_group_members member_row
        JOIN public.ontology_subjects subject_row ON subject_row.id = member_row.subject_id
        WHERE member_row.group_id = group_row.id AND subject_row.archived_at IS NULL
      ), '[]'::JSONB)
    ) ORDER BY group_row.created_at
  ), '[]'::JSONB) INTO result_groups
  FROM public.ontology_subject_groups group_row
  WHERE group_row.user_id = actor_id AND group_row.archived_at IS NULL;

  SELECT COALESCE(subject_group_id::TEXT, '') INTO result_major
  FROM public.ontology_rhythm_goals
  WHERE user_id = actor_id AND status = 'active' AND role = 'major'
  ORDER BY created_at
  LIMIT 1;
  SELECT COALESCE(subject_group_id::TEXT, '') INTO result_minor
  FROM public.ontology_rhythm_goals
  WHERE user_id = actor_id AND status = 'active' AND role = 'minor'
  ORDER BY created_at
  LIMIT 1;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', practice_row.id::TEXT,
    'subjectId', subject_row.id::TEXT,
    'subjectName', subject_row.name,
    'minutes', practice_row.minutes_per_day
  ) ORDER BY practice_row.created_at), '[]'::JSONB) INTO result_maintenance
  FROM public.ontology_maintenance_practices practice_row
  JOIN public.ontology_subjects subject_row ON subject_row.id = practice_row.subject_id
  WHERE practice_row.user_id = actor_id AND practice_row.active = TRUE;

  RETURN jsonb_build_object(
    'groups', result_groups,
    'majorGroupId', COALESCE(result_major, ''),
    'minorGroupId', COALESCE(result_minor, ''),
    'maintenance', result_maintenance,
    'updatedAt', timezone('utc'::text, now())
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_ontology_rhythm_plan(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_ontology_rhythm_plan(JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
