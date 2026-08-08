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
    description: 'Get full details of a task: description, status, comments, and change history.',
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
    description: 'Change a task\'s status.',
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
