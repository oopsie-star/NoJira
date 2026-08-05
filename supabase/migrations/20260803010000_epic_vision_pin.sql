-- Pinned "Product Vision" epic: a real epics row (not a synthetic UI card)
-- so the backlog's existing epic UI — inline title/description editing,
-- colored badge, attachments — works for it with zero new plumbing. Also
-- fixes the fact that projects.description had no edit UI at all after
-- creation: editing this epic's description becomes that edit UI.

alter table public.epics add column if not exists is_vision boolean not null default false;

create unique index if not exists epics_one_vision_per_project
  on public.epics (project_id) where is_vision;

-- Backfill existing projects. No `key` column set here — createTask and
-- createEpic never set it client-side either, confirming key assignment
-- happens in a pre-existing DB trigger on insert, so this raw insert gets
-- one the same way.
insert into public.epics (project_id, title, description, color, status, is_vision, created_by)
select p.id, 'Продуктовое видение «' || p.name || '»', coalesce(p.description, ''), '#0C66E4', 'planned', true, p.created_by
from public.projects p
where not exists (select 1 from public.epics e where e.project_id = p.id and e.is_vision);
