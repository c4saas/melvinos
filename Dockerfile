# ─────────────────────────────────────────────────────────────
#  MelvinOS — Docker Build
#  Multi-stage: builder → production
#
#  Stage 1 (builder): Install all deps, compile TS, build Vite
#  Stage 2 (production): Only prod deps + compiled output
# ─────────────────────────────────────────────────────────────

# ── Stage 1: Builder ─────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

# Build tools needed for native addons (sharp, canvas, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first (layer cache)
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDeps for build)
RUN npm install --ignore-scripts

# Rebuild native modules for this platform
RUN npm rebuild sharp

# Copy full source
COPY . .

# Build the application:
#   1. generate-admin-inventory (scripts/generate-admin-inventory.ts)
#   2. vite build  → dist/public/
#   3. esbuild     → dist/index.js
RUN npm run build

# ── Stage 2: Production ──────────────────────────────────────
FROM node:20-bookworm-slim AS production

# Runtime deps for sharp + tesseract OCR + SSH client for VPS access
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user early so npm install writes files owned by atlas
RUN groupadd --gid 1001 atlas && \
    useradd --uid 1001 --gid atlas --shell /bin/sh --create-home atlas

WORKDIR /app
RUN chown atlas:atlas /app && \
    mkdir -p /app/uploads/files /app/workspace && \
    chown -R atlas:atlas /app/uploads /app/workspace

USER atlas

# Copy only what's needed to run (owned by atlas via --chown)
COPY --chown=atlas:atlas package.json package-lock.json ./

# Install production dependencies + vite (needed by server/vite.ts at runtime)
RUN npm install --omit=dev --ignore-scripts && npm install vite --ignore-scripts && npm rebuild sharp

# Copy compiled output from builder stage
COPY --chown=atlas:atlas --from=builder /app/dist ./dist

# Copy tessdata for OCR (needed at runtime by tesseract.js)
COPY --chown=atlas:atlas --from=builder /app/server/tessdata ./server/tessdata

# Copy migrations for DB migration runner
COPY --chown=atlas:atlas --from=builder /app/migrations ./migrations

# Atlas serves on PORT (default 3001 — overridden by docker-compose)
EXPOSE 3001

# Healthcheck — polls the /api/auth/user endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3001) + '/api/auth/csrf-token').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Switch to root to install entrypoint (atlas can't write /usr/local/bin)
USER root
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Entrypoint runs as root (sets up SSH keys), then drops to atlas user
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
