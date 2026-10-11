-- =========================================================================
-- Supabase Seed: seed.sql
-- Mục tiêu: Seed tài khoản Admin quản trị toàn hệ thống (Idempotent 100%)
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_admin_id uuid;
  v_existing_id uuid;
  v_enc_pass text;
BEGIN
  -- Tìm tài khoản admin hiện có
  SELECT id INTO v_existing_id
  FROM auth.users
  WHERE lower(email) = 'admin@admin.com'
     OR lower(raw_user_meta_data->>'username') = 'admin'
  LIMIT 1;

  IF v_existing_id IS NULL THEN
    SELECT id INTO v_existing_id
    FROM public.profiles
    WHERE lower(username) = 'admin' OR lower(email) = 'admin@admin.com'
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    v_admin_id := v_existing_id;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_admin_id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;

    UPDATE public.profiles
    SET role = 'admin',
        username = COALESCE(username, 'admin'),
        status = 'active',
        full_name = COALESCE(full_name, 'Quản trị viên Hệ thống')
    WHERE id = v_admin_id;

  ELSE
    v_admin_id := 'b9e61e93-caa6-4e72-a534-55072d943ad2'::uuid;
    v_enc_pass := crypt('123456', gen_salt('bf', 10));

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token
    ) VALUES (
      '00000000-0000-4000-8000-000000000000',
      v_admin_id,
      'authenticated',
      'authenticated',
      'admin@admin.com',
      v_enc_pass,
      now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"full_name": "Quản trị viên Hệ thống", "username": "admin", "role": "admin", "must_change_password": true}'::jsonb,
      now(),
      now(),
      '',
      ''
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (
      id,
      email,
      full_name,
      username,
      role,
      status,
      must_change_password,
      profile_completed
    ) VALUES (
      v_admin_id,
      'admin@admin.com',
      'Quản trị viên Hệ thống',
      'admin',
      'admin',
      'active',
      true,
      true
    )
    ON CONFLICT (id) DO UPDATE
    SET role = 'admin',
        username = 'admin',
        status = 'active';

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_admin_id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;

  END IF;
END $$;
