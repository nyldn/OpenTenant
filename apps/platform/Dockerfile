# SPDX-License-Identifier: MIT
# Adapted from Next.js examples/with-docker, copyright (c) 2025 Vercel, Inc.
# Source revision and full MIT terms: THIRD_PARTY_NOTICES.md.
FROM node:22.23.2-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.13.1

FROM base AS dependencies
# Only allowlisted source directories enter the build. .dockerignore excludes
# local env files, credentials and generated output, including nested files.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json LICENSE ./
COPY --chown=node:node apps/platform ./apps/platform
COPY --chown=node:node packages ./packages
COPY --chown=node:node modules ./modules
COPY --chown=node:node examples ./examples
COPY --chown=node:node tooling ./tooling
COPY --chown=node:node templates ./templates
RUN pnpm install --frozen-lockfile

# One-shot control-plane migration image. No development seed runs here.
# The hosted runner requires an explicit --target host confirmation, so this
# default command fails closed; the deployment supplies the confirmed target.
FROM dependencies AS migrator
USER node
ENTRYPOINT ["node", "--experimental-strip-types", "tooling/migrations/src/hosted.mjs"]
CMD ["control-plane"]

FROM dependencies AS builder
RUN pnpm --filter @opentenant/platform build

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/apps/platform/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/platform/.next/static ./apps/platform/.next/static
COPY --from=builder --chown=node:node /app/apps/platform/public ./apps/platform/public
COPY --chown=node:node THIRD_PARTY_NOTICES.md ./
USER node
EXPOSE 3000
# A DNS Host is required by the host middleware, even for liveness probes.
HEALTHCHECK --interval=5s --timeout=3s --start-period=20s --retries=12 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:3000,path:'/api/health',headers:{Host:'health.localhost'}},r=>{r.resume();process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
CMD ["node", "apps/platform/server.js"]
