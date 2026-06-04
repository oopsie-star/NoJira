-- ── Jira import: Board vs Backlog placement ───────────────────────────────────
-- Jira splits a board's issues into "Board" (issues on the board) and "Backlog"
-- (issues in the board backlog). This isn't derivable from issue fields — it comes
-- from the board configuration (Agile API /board/{id}/backlog). We store the
-- placement per task so the NoJira backlog can mirror the same sections for any
-- imported project (Kanban → Board/Backlog; Scrum keeps sprint sections).
--
-- NULL = not imported from a board (manual tasks, or board without a backlog).

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS jira_board_placement text
    CHECK (jira_board_placement IN ('board', 'backlog'));
