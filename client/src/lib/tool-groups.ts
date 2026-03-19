/**
 * Canonical grouping of built-in agent tools for display in Tools and Skills pages.
 * Single source of truth — update here to affect both pages.
 */
export const BUILTIN_TOOL_GROUPS: { label: string; toolNames: string[] }[] = [
  { label: 'Google', toolNames: ['gmail_search', 'gmail_read', 'gmail_send', 'gmail_modify', 'calendar_events', 'calendar_create_event', 'calendar_update_event', 'calendar_delete_event', 'drive_search', 'drive_read', 'drive_write'] },
  { label: 'Notion', toolNames: ['notion_search', 'notion_read_page', 'notion_create_page', 'notion_update_page'] },
  { label: 'Recall AI', toolNames: ['recall_search', 'recall_meetings', 'recall_create_bot'] },
  { label: 'Gamma', toolNames: ['gamma_create'] },
  { label: 'Research & Web', toolNames: ['web_search', 'web_fetch', 'deep_research'] },
  { label: 'Files & Code', toolNames: ['file_read', 'file_write', 'file_edit', 'python_execute', 'shell_execute', 'claude_code'] },
  { label: 'Memory', toolNames: ['memory_save', 'memory_search', 'memory_delete'] },
  { label: 'Media', toolNames: ['image_generate', 'video_generate'] },
  { label: 'Tasks & Automation', toolNames: ['spawn_task', 'schedule_task', 'list_scheduled_tasks', 'delete_scheduled_task'] },
  { label: 'Remote Access', toolNames: ['ssh_execute'] },
  { label: 'System', toolNames: ['consolidate_data', 'skill_update'] },
];
