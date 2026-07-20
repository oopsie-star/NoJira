-- File extensions are unreliable for classifying uploads (especially audio —
-- recording apps use all sorts of extensions like .caf/.amr/.weba). Record the
-- browser-reported MIME type at upload time so previewKind() can trust it
-- instead of guessing from the filename.

alter table public.attachment_notes add column if not exists mime_type text;
