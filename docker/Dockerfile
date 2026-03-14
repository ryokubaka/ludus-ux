FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

# Bundle noVNC into a single browser ES module using esbuild.
# The @novnc/novnc npm package ships CJS (lib/rfb.js uses Babel-compiled require()),
# so we can't serve it as a native ES module directly. esbuild resolves all
# require() calls and outputs a single self-contained ESM file.
RUN npm install --no-save @novnc/novnc@1.5.0 && \
    mkdir -p /app/novnc-static && \
    npx --yes esbuild node_modules/@novnc/novnc/lib/rfb.js \
        --bundle --format=esm --outfile=/app/novnc-static/rfb.js && \
    rm -rf node_modules/@novnc

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED 1

# Copy the bundled noVNC ESM file into the Next.js public directory
COPY --from=deps /app/novnc-static ./public/novnc

RUN npm run build

# Compile the custom WebSocket proxy server into a self-contained CJS bundle.
# --external:next  keeps `next` as a runtime require() (it lives in standalone/node_modules).
# bufferutil/utf-8-validate are optional ws native addons — exclude so ws runs in pure-JS mode.
RUN npx esbuild server/ws-server.ts \
    --bundle \
    --platform=node \
    --target=node18 \
    --format=cjs \
    --external:./server \
    --external:bufferutil \
    --external:utf-8-validate \
    --external:ssh2 \
    --outfile=.next/standalone/ws-server.js

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
# noVNC files are already inside public/novnc (copied from deps stage → builder → here)

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Install openssl for self-signed TLS certificate generation at runtime
RUN apk add --no-cache openssl

# Create SSH keys directory
RUN mkdir -p /app/ssh && chown nextjs:nodejs /app/ssh

# Create persistent data directory (SQLite DB lives here; volume-mounted at runtime)
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

# Create certificates directory (volume-mounted; entrypoint auto-generates cert if empty)
RUN mkdir -p /app/certificates && chown nextjs:nodejs /app/certificates

# Copy and enable the entrypoint script.
# The entrypoint runs as root so it can inject hostname→IP mappings into
# /etc/hosts (needed when LUDUS_SSH_HOST is a name Docker can't resolve),
# then drops to the nextjs user before starting the app.
COPY docker/entrypoint.sh /app/docker-entrypoint.sh
# Strip Windows CRLF line endings so ash/sh can parse it on Alpine
RUN sed -i 's/\r//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

# Stay as root — entrypoint will su to nextjs after /etc/hosts setup.
EXPOSE 3000 443

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]
