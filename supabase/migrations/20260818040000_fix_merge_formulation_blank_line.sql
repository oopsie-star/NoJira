-- Fixes merge_formulation_revision: `result || ''` made Postgres read the bare
-- '' as an array literal ("malformed array literal") rather than as one empty
-- text element, so any revision that added a line failed the whole update.
-- array_append is unambiguous.

create or replace function public.merge_formulation_revision(old_text text, new_text text)
returns text
language plpgsql
immutable
as $$
declare
  old_lines text[] := string_to_array(coalesce(old_text, ''), E'\n');
  new_lines text[] := string_to_array(coalesce(new_text, ''), E'\n');
  result    text[] := '{}';
  line      text;
  added     text[] := '{}';
begin
  foreach line in array old_lines loop
    if btrim(line) = '' then
      result := array_append(result, line);
    elsif line = any (new_lines) then
      result := array_append(result, line);
    else
      -- Superseded: struck through, kept in place so the change reads in context.
      result := array_append(result, '~~' || line || '~~');
    end if;
  end loop;

  foreach line in array new_lines loop
    if btrim(line) <> '' and not (line = any (old_lines)) then
      added := array_append(added, line);
    end if;
  end loop;

  if coalesce(array_length(added, 1), 0) > 0 then
    result := array_append(result, '') || added;
  end if;

  return array_to_string(result, E'\n');
end;
$$;
