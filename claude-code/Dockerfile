FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Base deps
RUN apt-get update && apt-get install -y \
    curl \
    git \
    openssh-server \
    ripgrep \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user for Claude
RUN useradd -m -s /bin/bash claude && \
    echo "claude:claude" | chpasswd

# SSH setup (for interactive auth on first run)
RUN mkdir -p /run/sshd && \
    ssh-keygen -A && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    echo "PermitRootLogin no" >> /etc/ssh/sshd_config

# Auth volume mount point — persists across restarts
RUN mkdir -p /home/claude/.claude && chown -R claude:claude /home/claude/.claude

# Relay HTTP server
COPY relay.js /home/claude/relay.js
RUN chown claude:claude /home/claude/relay.js

COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 22 3333

CMD ["/start.sh"]
