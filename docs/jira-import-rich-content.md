# Jira import — rich description content (images, files, media)

## Why images in the body used to disappear

Jira stores issue descriptions in **Atlassian Document Format (ADF)** — a JSON
document tree. The importer converted ADF to plain text with `adfNodeToText()`,
which **skipped every `media` / `mediaSingle` node**. For developers who write
text that was fine, but designers frequently express the entire task as an
embedded screenshot. Those tasks imported as empty.

Plain text is now treated strictly as a **fallback**. The rich ADF is preserved
and rendered.

## Where things are stored

| Data | Location |
| --- | --- |
| Plain-text fallback | `tasks.description` (unchanged) |
| Raw ADF document | `tasks.jira_description_adf` (jsonb) |
| Extracted media refs | `tasks.description_media_refs` (jsonb array) |
| Imported files | Supabase Storage `task-attachments` bucket, paths in `tasks.attachments[]` |
| Source of truth for repair | `jira_external_mappings.raw_json.description` |

Media refs are produced by `extractAdfMediaRefs()` (edge function + `src/lib/adf.ts`)
and contain `{ id, type, collection, width, height, alt, url, localId }`.

## How media links to attachments

The Jira API does **not** expose the link between an ADF `media.attrs.id`
(media-services UUID) and a REST attachment `id`. So linking is done at render
time in `matchMediaToAttachment()` (`src/lib/adf.ts`):

1. **By filename** — `media.attrs.alt` vs the attachment's stored filename.
2. **Positional fallback** — next unused image attachment, in document order
   (covers the common "pasted screenshot" case with no `alt`).
3. **Any remaining unused attachment** for non-image inline files.

Unmatched media renders a `Файл из Jira` placeholder; the file always still
appears in the **Attachments** section, so nothing is ever lost.

## Rendering

`JiraDescriptionRenderer` (`src/components/task/JiraDescriptionRenderer.tsx`)
walks the ADF and renders: paragraphs, headings, bullet/ordered lists, list
items, hard breaks, blockquotes, code blocks, rules, links, strong/em/code/
strike/underline, mentions, emoji, dates, status, panels, tables, expands,
inline/block cards, and media. Media becomes:

- `image/*` → inline image preview (click to open full size)
- `application/pdf` → file card
- zip / archives → file card
- doc / docx / other → file card
- unknown / unmatched → "Файл из Jira" placeholder

`TaskDrawer` shows the renderer whenever `task.jira_description_adf` is present,
with an **Edit as text** toggle that falls back to the plain-text editor.

## Repairing already-imported tasks

Migration `20260604020000_jira_rich_description.sql`:

1. Adds the two columns.
2. Backfills `jira_description_adf` from `jira_external_mappings.raw_json.description`.
3. Extracts `description_media_refs` from that ADF with `jsonb_path_query`.

The edge function's finalization step also re-derives both columns from the
stored raw JSON, so re-running an import repairs older rows.

---

## Backlog: comments import (not yet implemented)

The importer fetches the `comment` field into `raw_json` but never writes
`task_comments`. The wizard checkbox is therefore **disabled** with a "Soon"
badge so users aren't misled.

Planned as a separate stage:

- Map Jira comment authors via the existing `resolveJiraUser` placeholder flow.
- Convert each comment's ADF body the same way descriptions are handled
  (`jira_description_adf` equivalent on `task_comments`, plain-text fallback).
- **Designer images can live in comments too** — comment attachments and inline
  media must be preserved and rendered with the same renderer, not dropped.
- Import as a dedicated cursor phase (`comments`) after attachments to stay
  within the Edge Function time budget.
