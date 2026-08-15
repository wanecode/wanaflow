FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/job-worker/package.json packages/job-worker/package.json
COPY packages/modeling/package.json packages/modeling/package.json
COPY packages/runtime/package.json packages/runtime/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
# Next imports server routes while collecting build metadata. These values only
# satisfy configuration shape checks; Compose injects real runtime credentials.
RUN BETTER_AUTH_URL=http://127.0.0.1:3000 \
    BETTER_AUTH_SECRET=wanaflow-image-build-placeholder-not-a-runtime-secret \
    DATABASE_URL=postgresql://wanaflow:build-only@127.0.0.1:5432/wanaflow \
    COPILOTKIT_TELEMETRY_DISABLED=true \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    pnpm build

FROM build AS release
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@wanaflow/web", "start"]
