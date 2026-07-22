-- A project member vanished with no trace of who removed them (or whether it
-- was even intentional vs a mis-tap) — the activity log had no event type for
-- membership changes at all. Add remove_member/add_member so this is
-- traceable going forward.

alter table public.activity_events drop constraint activity_events_event_type_check;
alter table public.activity_events add constraint activity_events_event_type_check
  check (event_type in ('login', 'view_task', 'download_attachment', 'play_audio', 'remove_member', 'add_member'));
