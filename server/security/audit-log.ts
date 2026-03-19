/**
 * Audit logger for sensitive operations.
 * Logs to both console and a structured format for future DB persistence.
 */

export type AuditAction =
  | 'settings.read'
  | 'settings.update'
  | 'settings.restore'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.setup'
  | 'auth.password_change'
  | 'task.create'
  | 'task.cancel'
  | 'routine.populate'
  | 'webhook.recall'
  | 'mcp.connect'
  | 'mcp.disconnect'
  | 'ssh.execute';

interface AuditEntry {
  timestamp: string;
  action: AuditAction;
  userId?: string;
  ip?: string;
  detail?: string;
}

const auditBuffer: AuditEntry[] = [];
const MAX_BUFFER_SIZE = 1000;

export function audit(action: AuditAction, opts?: { userId?: string; ip?: string; detail?: string }): void {
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    action,
    userId: opts?.userId,
    ip: opts?.ip,
    detail: opts?.detail,
  };

  // Log to console in structured format
  console.log(`[audit] ${entry.action} | user=${entry.userId ?? 'anon'} | ip=${entry.ip ?? '-'} | ${entry.detail ?? ''}`);

  // Buffer for future DB persistence
  auditBuffer.push(entry);
  if (auditBuffer.length > MAX_BUFFER_SIZE) {
    auditBuffer.splice(0, auditBuffer.length - MAX_BUFFER_SIZE);
  }
}

export function getRecentAuditEntries(limit = 100): AuditEntry[] {
  return auditBuffer.slice(-limit);
}
