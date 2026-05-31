-- Approval notification durability + hidden global admin support
-- Apply this to existing environments. After applying, assign one hidden
-- workspace operator with: update public.profiles set role = 'admin' where id = ...;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approval_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_email_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_email_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approval_email_last_error text;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  );
$$;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (
    auth.uid() = id OR public.shares_project_with(id) OR public.is_admin()
  );

DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
CREATE POLICY profiles_update_admin ON public.profiles
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
