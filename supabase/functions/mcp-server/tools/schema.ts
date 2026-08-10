import { ISSUE_PRIORITIES, ISSUE_TYPES, TASK_STATUSES } from '../types.ts'

export interface McpToolSchema {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

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
    description: 'Get full details of a task: description, status, comments, attachments, and change history.',
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
      },
      required: ['project', 'title'],
    },
  },
  {
    name: 'update_task_status',
    description: 'Change a task\'s status. For any other field, use update_task instead.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task key or id.' },
        status: { type: 'string', enum: TASK_STATUSES },
      },
      required: ['task', 'status'],
    },
  },
  {
    name: 'update_task',
    description:
      'Update a task\'s title, description, priority, due date, assignee, epic, sprint, or labels. For status changes, use update_task_status instead.',
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
      },
      required: ['task'],
    },
  },
  {
    name: 'get_project',
    description: 'Get a project\'s epics, sprints (each with their attachments), and members.',
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
      },
      required: ['project', 'title'],
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
      },
      required: ['project', 'name'],
    },
  },
  {
    name: 'attach_task_file',
    description:
      'Attach a file to a task (max 20MB). content_base64 is the raw file content, base64-encoded. To mark a previous attachment as superseded, call rename_attachment on it with "УСТАРЕЛО " prefixed to its current name.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task key or id.' },
        filename: { type: 'string', description: 'Original filename, e.g. "spec.pdf" — any script, does not need to be ASCII.' },
        content_base64: { type: 'string', description: 'Raw file bytes, base64-encoded.' },
        mime_type: { type: 'string', description: 'Optional MIME type, e.g. "application/pdf".' },
      },
      required: ['task', 'filename', 'content_base64'],
    },
  },
  {
    name: 'attach_epic_file',
    description: 'Attach a file to an epic (max 20MB). See attach_task_file for content_base64 details.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key.' },
        epic: { type: 'string', description: 'Epic key or title.' },
        filename: { type: 'string' },
        content_base64: { type: 'string', description: 'Raw file bytes, base64-encoded.' },
        mime_type: { type: 'string' },
      },
      required: ['project', 'epic', 'filename', 'content_base64'],
    },
  },
  {
    name: 'attach_sprint_file',
    description: 'Attach a file to a sprint (max 20MB). See attach_task_file for content_base64 details.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project key.' },
        sprint: { type: 'string', description: 'Sprint name.' },
        filename: { type: 'string' },
        content_base64: { type: 'string', description: 'Raw file bytes, base64-encoded.' },
        mime_type: { type: 'string' },
      },
      required: ['project', 'sprint', 'filename', 'content_base64'],
    },
  },
  {
    name: 'rename_attachment',
    description:
      'Rename an attachment (works for task, epic, or sprint attachments alike — pass the path from get_task/get_project\'s attachments list). To mark it as superseded by a new attachment you just created, set new_name to "УСТАРЕЛО " + its current name.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The attachment\'s storage path, from get_task/get_project.' },
        new_name: { type: 'string' },
      },
      required: ['path', 'new_name'],
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment to a task.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task key or id.' },
        body: { type: 'string' },
      },
      required: ['task', 'body'],
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
]
