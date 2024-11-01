FROM oven/bun:1 AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json bun.lockb ./
RUN \
  if [ -f bun.lockb ]; then bun install --frozen-lockfile; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG VITE_PUBLIC_GIT_SHA
ENV VITE_PUBLIC_GIT_SHA $VITE_PUBLIC_GIT_SHA

RUN bun run build

# Production image, copy all the files and run vite
FROM base AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 bunjs
RUN adduser --system --uid 1001 webuser

# Copy the built assets
COPY --from=builder --chown=webuser:bunjs /app/dist ./dist
COPY --from=builder --chown=webuser:bunjs /app/package.json ./package.json

USER webuser

EXPOSE 3000

ENV PORT 3000
ENV HOST 0.0.0.0

# Using vite preview for production serving
CMD ["bun", "run", "start"]