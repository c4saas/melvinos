#!/bin/sh
set -e

# ── SSH key setup ────────────────────────────────────────────────────────────
# If the claude_ssh source volume is mounted at /var/ssh-keys-src, copy all
# keys into the melvinos user's .ssh dir with correct ownership.
SSH_SRC="/var/ssh-keys-src"
SSH_DST="/home/melvinos/.ssh"

if [ -d "$SSH_SRC" ] && [ "$(ls -A $SSH_SRC 2>/dev/null)" ]; then
  mkdir -p "$SSH_DST"
  # Copy all files from the SSH source volume
  cp -a "$SSH_SRC/." "$SSH_DST/" 2>/dev/null || true
  chown -R melvinos:melvinos "$SSH_DST"
  chmod 700 "$SSH_DST"
  # Set permissions on private keys (anything without .pub extension)
  find "$SSH_DST" -type f ! -name "*.pub" -exec chmod 600 {} \;
  find "$SSH_DST" -type f -name "*.pub" -exec chmod 644 {} \;
fi

# ── Drop to melvinos user and exec the app ───────────────────────────────────
exec su -s /bin/sh -c 'exec "$@"' melvinos melvinos "$@"
