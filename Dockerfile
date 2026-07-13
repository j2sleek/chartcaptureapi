# syntax=docker/dockerfile:1

###############################################################################
# ChartCapture API — multi-stage build on the official Playwright image, which
# ships Chromium plus every system library the browser needs. The image tag is
# pinned to the Playwright version in package.json; keep them in lockstep.
###############################################################################

# ── Stage 1: build (install all deps, compile TypeScript) ────────────────────
FROM mcr.microsoft.com/playwright:v1.61.1-noble AS build
WORKDIR /app

ENV NODE_ENV=development \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install dependencies against the lockfile first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Compile.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: production deps only ────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.61.1-noble AS deps
WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.61.1-noble AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# The Playwright image provides a non-root "pwuser"; run as it.
RUN chown -R pwuser:pwuser /app
USER pwuser

EXPOSE 3000

# Liveness probe hits the health endpoint (no external tooling required).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
