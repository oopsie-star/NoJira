import { ISSUE_PRIORITIES, ISSUE_TYPES, TASK_STATUSES } from '../types.ts'

export interface McpToolSchema {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

// Claude and ChatGPT both reach this server through the same static
// credential — there is no transport-level way to tell them apart, so every
// write tool requires this self-declared field instead.
const AGENT_NAME_PROPERTY = {
  type: 'string',
  enum: ['claude', 'chatgpt'],
  description: 'Identify yourself: "claude" if you are Claude, "chatgpt" if you are ChatGPT.',
}

const CONFIRMED_CROSS_AGENT_PROPERTY = {
  type: 'boolean',
  description:
    'Only set this to true after the human operator has explicitly confirmed the change, in response to this same call being rejected for a cross-agent conflict. Omit otherwise.',
}

const MAP_DISCIPLINES = ['backend', 'frontend', 'design', 'qa']

const CROSS_AGENT_NOTE =
  ' If this item was last modified by a different AI (Claude vs ChatGPT vs the in-app assistant), this call is rejected until the human operator confirms — then retry with confirmed_cross_agent: true.'

export const TOOL_SCHEMAS: McpToolSchema[] = [
  {
    name: 'list_tasks',
    description: 'List tasks in a project, optionally filtered by status and/or assignee.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key, e.g. "PROJ".' },
        status: { type: 'string', enum: TASK_STATUSES },
        assignee_email: { type: 'string', description: 'Filter to tasks assigned (solely or jointly) to this person.' },
      },
      required: ['project'],
    },
  },
  {
    name: 'get_task',
    description:
      'Get full details of a task: description, status, comments, attachments, change history, and last_ai_agent (which AI — claude/chatgpt/qira-assistant — last modified it, and when).',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task key (e.g. "PROJ-42") or id (uuid).' },
      },
      required: ['task'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task in a project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key.' },
        title: { type: 'string' },
        description: { type: 'string' },
        issue_type: { type: 'string', enum: ISSUE_TYPES },
        priority: { type: 'string', enum: ISSUE_PRIORITIES },
        assignee_email: { type: 'string' },
        epic: { type: 'string', description: 'Epic key or title, resolved within the project.' },
        sprint: { type: 'string', description: 'Sprint name, resolved within the project.' },
        agent_name: AGENT_NAME_PROPERTY,
      },
      required: ['project', 'title', 'agent_name'],
    },
  },
  {
    name: 'update_task_status',
    description: `Change a task's status. For any other field, use update_task instead.${CROSS_AGENT_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task key or id.' },
        status: { type: 'string', enum: TASK_STATUSES },
        agent_name: AGENT_NAME_PROPERTY,
        confirmed_cross_agent: CONFIRMED_CROSS_AGENT_PROPERTY,
      },
      required: ['task', 'status', 'agent_name'],
    },
  },
  {
    name: 'update_task',
    description:
      `Update a task's title, description, priority, due date, assignee, epic, sprint, or labels. For status changes, use update_task_status instead.${CROSS_AGENT_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task key or id.' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ISSUE_PRIORITIES },
        due_date: { type: 'string', description: 'ISO date, e.g. "2026-08-20".' },
        assignee_email: { type: 'string' },
        epic: { type: 'string', description: 'Epic key or title, resolved within the project. Empty string clears it.' },
        sprint: { type: 'string', description: 'Sprint name, resolved within the project. Empty string clears it.' },
        labels: { type: 'array', items: { type: 'string' } },
        agent_name: AGENT_NAME_PROPERTY,
        confirmed_cross_agent: CONFIRMED_CROSS_AGENT_PROPERTY,
      },
      required: ['task', 'agent_name'],
    },
  },
  {
    name: 'get_project',
    description:
      'Get a project\'s epics, sprints (each with their attachments and last_ai_agent), and members.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key.' },
      },
      required: ['project'],
    },
  },
  {
    name: 'create_epic',
    description: 'Create a new epic in a project.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key.' },
        title: { type: 'string' },
        description: { type: 'string' },
        agent_name: AGENT_NAME_PROPERTY,
      },
      required: ['project', 'title', 'agent_name'],
    },
  },
  {
    name: 'create_sprint',
    description: 'Create a new sprint in a project, optionally under an epic.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key.' },
        name: { type: 'string' },
        goal: { type: 'string' },
        epic: { type: 'string', description: 'Epic key or title, resolved within the project.' },
        agent_name: AGENT_NAME_PROPERTY,
      },
      required: ['project', 'name', 'agent_name'],
    },
  },
  {
    name: 'attach_task_file',
    description:
      `Attach a file to a task (max 20MB). content_base64 is the raw file content, base64-encoded. To mark a previous attachment as superseded, call rename_attachment on it with "УСТАРЕЛО " prefixed to its current name.${CROSS_AGENT_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task key or id.' },
        filename: { type: 'string', description: 'Original filename, e.g. "spec.pdf" — any script, does not need to be ASCII.' },
        content_base64: { type: 'string', description: 'Raw file bytes, base64-encoded.' },
        mime_type: { type: 'string', description: 'Optional MIME type, e.g. "application/pdf".' },
        agent_name: AGENT_NAME_PROPERTY,
        confirmed_cross_agent: CONFIRMED_CROSS_AGENT_PROPERTY,
      },
      required: ['task', 'filename', 'content_base64', 'agent_name'],
    },
  },
  {
    name: 'attach_epic_file',
    description: `Attach a file to an epic (max 20MB). See attach_task_file for content_base64 details.${CROSS_AGENT_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key.' },
        epic: { type: 'string', description: 'Epic key or title.' },
        filename: { type: 'string' },
        content_base64: { type: 'string', description: 'Raw file bytes, base64-encoded.' },
        mime_type: { type: 'string' },
        agent_name: AGENT_NAME_PROPERTY,
        confirmed_cross_agent: CONFIRMED_CROSS_AGENT_PROPERTY,
      },
      required: ['project', 'epic', 'filename', 'content_base64', 'agent_name'],
    },
  },
  {
    name: 'attach_sprint_file',
    description: `Attach a file to a sprint (max 20MB). See attach_task_file for content_base64 details.${CROSS_AGENT_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key.' },
        sprint: { type: 'string', description: 'Sprint name.' },
        filename: { type: 'string' },
        content_base64: { type: 'string', description: 'Raw file bytes, base64-encoded.' },
        mime_type: { type: 'string' },
        agent_name: AGENT_NAME_PROPERTY,
        confirmed_cross_agent: CONFIRMED_CROSS_AGENT_PROPERTY,
      },
      required: ['project', 'sprint', 'filename', 'content_base64', 'agent_name'],
    },
  },
  {
    name: 'rename_attachment',
    description:
      `Rename an attachment (works for task, epic, or sprint attachments alike — pass the path from get_task/get_project's attachments list). To mark it as superseded by a new attachment you just created, set new_name to "УСТАРЕЛО " + its current name.${CROSS_AGENT_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The attachment\'s storage path, from get_task/get_project.' },
        new_name: { type: 'string' },
        agent_name: AGENT_NAME_PROPERTY,
        confirmed_cross_agent: CONFIRMED_CROSS_AGENT_PROPERTY,
      },
      required: ['path', 'new_name', 'agent_name'],
    },
  },
  {
    name: 'add_comment',
    description: `Add a comment to a task.${CROSS_AGENT_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task key or id.' },
        body: { type: 'string' },
        agent_name: AGENT_NAME_PROPERTY,
        confirmed_cross_agent: CONFIRMED_CROSS_AGENT_PROPERTY,
      },
      required: ['task', 'body', 'agent_name'],
    },
  },
  {
    name: 'read_attachment',
    description:
      'Download an existing attachment\'s raw content as base64 — works for any file type, including archives, but returns raw bytes only (you cannot browse/unzip an archive through this — just fetch it). Use the path from get_task/get_project\'s attachments list.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The attachment\'s storage path, from get_task/get_project.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'mark_task_superseded',
    description:
      'Mark a task as obsolete, replaced by a newer task — links them and sinks the old task toward the bottom of the backlog, instead of manually prefixing its title with "[устарело]".',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The OLD task (key or id) that is now obsolete.' },
        superseded_by: { type: 'string', description: 'The NEW task (key or id) that replaces it.' },
        agent_name: AGENT_NAME_PROPERTY,
      },
      required: ['task', 'superseded_by', 'agent_name'],
    },
  },
  {
    name: 'search_tasks',
    description: 'Search tasks by a substring match on title and description.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        project: { type: 'string', description: 'Optional — restrict to one project by key.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_projects',
    description:
      'List every project in Qira, including empty ones with no tasks yet. Call this whenever you are unsure what projects exist, or before guessing a project key.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_project',
    description:
      'Create a new project. State the project name and key back to the human operator and get their go-ahead before calling this — creating the wrong project is hard to undo cleanly.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        key: { type: 'string', description: 'Short uppercase key, e.g. "PROJ". Auto-generated from name if omitted.' },
        description: { type: 'string' },
        owner_email: { type: 'string', description: 'Email of the profile who should own this project.' },
        agent_name: AGENT_NAME_PROPERTY,
      },
      required: ['name', 'owner_email', 'agent_name'],
    },
  },
  {
    name: 'get_project_map',
    description:
      'Read the Project Map: per-discipline (backend/frontend/design/qa) blocks of structured project knowledge, each with its linked tasks/epics and the questions and answers attached to it. Call this before writing to the map so you update existing blocks instead of duplicating them.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key.' },
        discipline: {
          type: 'string',
          enum: MAP_DISCIPLINES,
          description: 'Optional — restrict to one discipline.',
        },
      },
      required: ['project'],
    },
  },
  {
    name: 'upsert_project_map_block',
    description:
      'Create or replace one Project Map block — a titled piece of structured knowledge (markdown body) for one discipline, optionally linked to the tasks and epics it derives from. Identified by block_id when given, otherwise by (project, discipline, title): re-running with the same title updates that block rather than adding a second one. Derive the content from the project\'s tasks, epics and canon — never invent architecture or rules that are not in the project data.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key.' },
        discipline: { type: 'string', enum: MAP_DISCIPLINES },
        title: { type: 'string', description: 'Block heading — also its identity within the discipline when block_id is omitted.' },
        body: { type: 'string', description: 'Markdown body of the block.' },
        block_id: { type: 'string', description: 'Update this exact block (from get_project_map). Omit to match on title.' },
        linked_tasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task keys (e.g. "PROJ-42") or ids this block derives from. Replaces the existing set.',
        },
        linked_epics: {
          type: 'array',
          items: { type: 'string' },
          description: 'Epic keys, titles, or ids this block derives from. Replaces the existing set.',
        },
        position: { type: 'number', description: 'Sort order within the discipline (ascending).' },
        agent_name: AGENT_NAME_PROPERTY,
      },
      required: ['project', 'discipline', 'title', 'agent_name'],
    },
  },
  {
    name: 'delete_project_map_block',
    description: 'Delete a Project Map block and the questions and answers attached to it. Confirm with the human operator first.',
    inputSchema: {
      type: 'object',
      properties: {
        block_id: { type: 'string', description: 'Block id from get_project_map.' },
        agent_name: AGENT_NAME_PROPERTY,
      },
      required: ['block_id', 'agent_name'],
    },
  },
  {
    name: 'post_project_map_qa',
    description:
      'Post a question on a Project Map block, or answer an existing question by passing answer_to. Q&A is always bound to one block, so answer the question in terms of that block\'s content and the project data behind it.',
    inputSchema: {
      type: 'object',
      properties: {
        block_id: { type: 'string', description: 'Block to ask about. Ignored (inherited from the question) when answer_to is set.' },
        answer_to: { type: 'string', description: 'Question id being answered — omit to post a new question.' },
        body: { type: 'string' },
        agent_name: AGENT_NAME_PROPERTY,
      },
      required: ['body', 'agent_name'],
    },
  },
]
