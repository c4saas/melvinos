#!/bin/bash
set -e

# Start SSH daemon (for interactive auth setup on first run)
mkdir -p /run/sshd
/usr/sbin/sshd

# Ensure workspace dirs exist and are owned by claude
mkdir -p /workspace /home/claude/workspace
chown claude:claude /home/claude/workspace 2>/dev/null || true

# Copy SSH keys from root to claude user so the relay can reach remote hosts (e.g. Hostinger)
if [ -d /root/.ssh ] && [ "$(ls -A /root/.ssh 2>/dev/null)" ]; then
  mkdir -p /home/claude/.ssh
  cp -f /root/.ssh/* /home/claude/.ssh/ 2>/dev/null || true
  # Rewrite IdentityFile paths from /root/.ssh to /home/claude/.ssh in the config
  if [ -f /home/claude/.ssh/config ]; then
    sed -i 's|/root/.ssh/|/home/claude/.ssh/|g' /home/claude/.ssh/config
  fi
  chown -R claude:claude /home/claude/.ssh
  chmod 700 /home/claude/.ssh
  chmod 600 /home/claude/.ssh/id_* 2>/dev/null || true
  chmod 644 /home/claude/.ssh/*.pub 2>/dev/null || true
  chmod 644 /home/claude/.ssh/config 2>/dev/null || true
  chmod 644 /home/claude/.ssh/known_hosts* 2>/dev/null || true
  echo "  SSH keys: copied from /root/.ssh → /home/claude/.ssh (paths rewritten)"
fi

# Restore .claude.json from backup if missing (happens after volume recreate)
if [ ! -f /home/claude/.claude.json ] && [ -d /home/claude/.claude/backups ]; then
  latest_backup=$(ls -t /home/claude/.claude/backups/.claude.json.backup.* 2>/dev/null | head -1)
  if [ -n "$latest_backup" ]; then
    cp "$latest_backup" /home/claude/.claude.json
    chown claude:claude /home/claude/.claude.json
    echo "  Config: restored .claude.json from backup"
  fi
fi

echo "Claude Code relay starting..."
echo "  SSH:   port 22  (first-time auth: ssh claude@<host> -p 2222)"
echo "  HTTP:  port 3333 (MelvinOS tool relay)"

# Run relay as claude user (so it can access ~/.claude/ credentials)
exec su -s /bin/bash claude -c "node /home/claude/relay.js"
