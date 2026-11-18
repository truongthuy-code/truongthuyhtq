-- =========================================================================
-- Supabase Seed: seed.sql
-- Mục tiêu: Seed 01 tài khoản SUPER_ADMIN duy nhất: bichthuylqd@gmail.com
-- Nguyên tắc: Idempotent 100%, không reset mật khẩu nếu tài khoản đã đổi mật khẩu.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_super_id uuid;
  v_enc_pass text;
BEGIN
  SELECT id INTO v_super_id
  FROM auth.users
  WHERE lower(email) = 'bichthuylqd@gmail.com'
  LIMIT 1;

  IF v_super_id IS NOT NULL THEN
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"super_admin"}'::jsonb,
        email_confirmed_at = COALESCE(email_confirmed_at, now())
    WHERE id = v_super_id;

    INSERT INTO public.profiles (
      id, email, full_name, username, role, status, approval_status,
      must_change_password, profile_completed, approved_at, is_deleted
    ) VALUES (
      v_super_id,
      'bichthuylqd@gmail.com',
      'Trương Thị Bích Thủy',
      'bichthuylqd',
      'super_admin',
      'active',
      'APPROVED',
      false,
      true,
      now(),
      false
    )
    ON CONFLICT (id) DO UPDATE
    SET email = 'bichthuylqd@gmail.com',
        role = 'super_admin',
        status = 'active',
        approval_status = 'APPROVED',
        is_deleted = false,
        profile_completed = true,
        full_name = COALESCE(NULLIF(public.profiles.full_name, ''), 'Trương Thị Bích Thủy'),
        username = COALESCE(NULLIF(public.profiles.username, ''), 'bichthuylqd');
  ELSE
    v_super_id := gen_random_uuid();
    v_enc_pass := crypt('123456', gen_salt('bf', 10));

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token
    ) VALUES (
      '00000000-0000-4000-8000-000000000000',
      v_super_id,
      'authenticated',
      'authenticated',
      'bichthuylqd@gmail.com',
      v_enc_pass,
      now(),
      '{"provider":"email","providers":["email"],"role":"super_admin"}'::jsonb,
      '{"full_name":"Trương Thị Bích Thủy","username":"bichthuylqd"}'::jsonb,
      now(),
      now(),
      '',
      ''
    )
    ON CONFLICT (id) DO NOTHING;

    BEGIN
      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        v_super_id,
        v_super_id,
        jsonb_build_object('sub', v_super_id::text, 'email', 'bichthuylqd@gmail.com'),
        'email',
        v_super_id::text,
        now(),
        now(),
        now()
      )
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    INSERT INTO public.profiles (
      id, email, full_name, username, role, status, approval_status,
      must_change_password, profile_completed, approved_at, is_deleted
    ) VALUES (
      v_super_id,
      'bichthuylqd@gmail.com',
      'Trương Thị Bích Thủy',
      'bichthuylqd',
      'super_admin',
      'active',
      'APPROVED',
      true,
      true,
      now(),
      false
    )
    ON CONFLICT (id) DO UPDATE
    SET role = 'super_admin',
        status = 'active',
        approval_status = 'APPROVED',
        must_change_password = true,
        profile_completed = true,
        is_deleted = false;
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (v_super_id, 'super_admin') ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_super_id, 'admin') ON CONFLICT DO NOTHING;
END $$;
