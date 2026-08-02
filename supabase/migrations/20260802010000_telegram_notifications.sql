-- Telegram notifications: account linking + a permission gate on disconnect.
--
-- Linking uses a one-time code in its own table (not a profiles column) so
-- the code isn't visible to teammates via the existing profiles_select
-- policy (self OR shares_project_with OR admin) while it's still valid —
-- whoever uses a code first wins that person's notifications.
--
-- Disconnecting is explicitly NOT self-service: only the global super admin
-- or a founder/ceo who shares a project with the account owner may clear
-- telegram_chat_id. Enforced with a trigger, not just hidden UI, so it
-- can't be bypassed by calling the update directly. auth.uid() is null for
-- service-role calls (the webhook setting telegram_chat_id on link), so
-- linking is unaffected — the trigger only guards the clear-to-null path.

alter table public.profiles add column if not exists telegram_chat_id bigint;

create table public.telegram_link_codes (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  code       text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.telegram_link_codes enable row level security;

create policy telegram_link_codes_self on public.telegram_link_codes
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create or replace function public.can_manage_telegram_link(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1
      from public.project_members pm_actor
      join public.project_members pm_target
        on pm_actor.project_id = pm_target.project_id
      where pm_actor.profile_id = auth.uid()
        and pm_target.profile_id = target_profile_id
        and pm_actor.project_role in ('founder', 'ceo')
    );
$$;

create or replace function public.enforce_telegram_disconnect_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.telegram_chat_id is null
     and old.telegram_chat_id is not null
     and auth.uid() is not null
     and not public.can_manage_telegram_link(old.id) then
    raise exception 'Only a super admin, founder, or CEO can disconnect Telegram for this account.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_telegram_disconnect_guard on public.profiles;
create trigger profiles_telegram_disconnect_guard
  before update on public.profiles
  for each row execute function public.enforce_telegram_disconnect_permission();
