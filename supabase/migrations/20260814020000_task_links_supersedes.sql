-- Adds a 'supersedes' task_links type so an obsolete task can be linked to
-- its replacement instead of only being marked with a manual "[устарело]"
-- title prefix. Direction mirrors 'blocks': source_task_id is the newer/
-- active task, target_task_id is the older/obsolete one being replaced.

alter table public.task_links drop constraint if exists task_links_link_type_check;
alter table public.task_links
  add constraint task_links_link_type_check
  check (link_type in ('blocks', 'relates_to', 'duplicates', 'supersedes'));
