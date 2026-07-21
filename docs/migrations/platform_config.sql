-- Platform Config + Roles (retry after PGRST002 schema-cache outage)
-- Run this once the backend recovers (backend is currently returning PGRST002).
-- Idempotent — safe to run multiple times.

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL    ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_read_own_roles" ON public.user_roles;
CREATE POLICY "users_read_own_roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE TABLE IF NOT EXISTS public.platform_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  hsmcpay_intermediary_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);
INSERT INTO public.platform_config (id, hsmcpay_intermediary_enabled)
VALUES (1, true) ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.platform_config TO authenticated, anon;
GRANT ALL    ON public.platform_config TO service_role;
ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone_reads_platform_config" ON public.platform_config;
CREATE POLICY "anyone_reads_platform_config"
  ON public.platform_config FOR SELECT USING (true);
DROP POLICY IF EXISTS "only_admins_update_platform_config" ON public.platform_config;
CREATE POLICY "only_admins_update_platform_config"
  ON public.platform_config FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- To grant yourself admin (replace <YOUR_USER_UUID>):
-- INSERT INTO public.user_roles (user_id, role) VALUES ('<YOUR_USER_UUID>', 'admin');
