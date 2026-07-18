-- Repair tasks where description was stored as raw Atlassian Document Format (ADF) JSON
-- during a Jira import before the ADF-to-text converter was added.
--
-- Uses jsonb_path_query to find all ADF text nodes recursively and concatenate them.
-- Runs only on rows whose description starts with '{"type":"doc"'.

DO $$
DECLARE
  r RECORD;
  plain TEXT;
BEGIN
  FOR r IN
    SELECT id, description
    FROM public.tasks
    WHERE description LIKE '{"type":"doc"%'
      AND description <> ''
  LOOP
    BEGIN
      -- Extract all ADF text nodes: {"type":"text","text":"..."} at any depth
      SELECT string_agg(jnode ->> 'text', ' ')
      INTO plain
      FROM jsonb_path_query(
        r.description::jsonb,
        '$.** ? (@.type == "text")'
      ) AS jnode
      WHERE jnode ->> 'text' IS NOT NULL
        AND jnode ->> 'text' <> '';

      UPDATE public.tasks
      SET description = COALESCE(trim(plain), '')
      WHERE id = r.id;

    EXCEPTION WHEN OTHERS THEN
      -- If JSON is malformed, clear the description rather than leave raw JSON
      UPDATE public.tasks SET description = '' WHERE id = r.id;
    END;
  END LOOP;
END;
$$;
