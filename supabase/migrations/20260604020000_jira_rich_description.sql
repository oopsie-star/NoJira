-- ── Jira import: preserve rich description content (images, files, media) ──────
-- Designers often put the whole meaning of a task inside images embedded in the
-- Jira description (ADF media nodes) rather than text. The previous importer ran
-- adfNodeToText() which DROPPED every media/mediaSingle node, so those tasks
-- landed in NoJira looking empty.
--
-- This migration:
--   1. Adds two nullable jsonb columns to tasks:
--        jira_description_adf    — the raw Atlassian Document Format document
--        description_media_refs  — extracted media refs ([{id,type,collection,…}])
--   2. Backfills both for already-imported tasks using the raw ADF that was
--      stored in jira_external_mappings.raw_json -> 'description'.
--
-- Plain-text `description` stays as the fallback; the UI renders the ADF richly
-- when jira_description_adf is present.

-- ── 1. New columns ────────────────────────────────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS jira_description_adf   jsonb,
  ADD COLUMN IF NOT EXISTS description_media_refs jsonb;

-- ── 2. Backfill raw ADF from the import mappings ──────────────────────────────
-- Only rows whose stored Jira description is an ADF document (type = "doc").
-- local_entity_id is text (it also stores placeholder:/storage-path values), so
-- compare against the task UUID cast to text. Issue mappings always hold a task id.
UPDATE public.tasks t
SET jira_description_adf = (m.raw_json -> 'description')
FROM public.jira_external_mappings m
WHERE m.local_entity_type = 'issue'
  AND m.local_entity_id = t.id::text
  AND jsonb_typeof(m.raw_json -> 'description') = 'object'
  AND (m.raw_json -> 'description' ->> 'type') = 'doc'
  AND t.jira_description_adf IS NULL;

-- ── 3. Extract media refs from the ADF (recursive, any depth) ─────────────────
-- jsonb_path_query walks the whole document; we keep both `media` (block/group)
-- and `mediaInline` nodes. Width/height stay as raw jsonb (number or null).
UPDATE public.tasks t
SET description_media_refs = sub.refs
FROM (
  SELECT t2.id,
         jsonb_agg(
           jsonb_build_object(
             'id',         node -> 'attrs' ->> 'id',
             'type',       node -> 'attrs' ->> 'type',
             'collection', node -> 'attrs' ->> 'collection',
             'width',      node -> 'attrs' -> 'width',
             'height',     node -> 'attrs' -> 'height',
             'alt',        node -> 'attrs' ->> 'alt',
             'url',        node -> 'attrs' ->> 'url',
             'localId',    node -> 'attrs' ->> 'localId'
           )
         ) AS refs
  FROM public.tasks t2
  CROSS JOIN LATERAL jsonb_path_query(
    t2.jira_description_adf,
    '$.** ? (@.type == "media" || @.type == "mediaInline")'
  ) AS node
  WHERE t2.jira_description_adf IS NOT NULL
  GROUP BY t2.id
) sub
WHERE sub.id = t.id;

-- Tasks that have ADF but no media get an explicit empty array so the UI can
-- distinguish "checked, none" from "never processed" (NULL).
UPDATE public.tasks
SET description_media_refs = '[]'::jsonb
WHERE jira_description_adf IS NOT NULL
  AND description_media_refs IS NULL;
