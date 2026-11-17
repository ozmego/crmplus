# syntax=docker/dockerfile:1.7
# crmPlus üretim imajları (docs/12):
#   app     — Next.js bağımsız sunucu (standalone), port 3000
#   worker  — BullMQ işçisi + araçlar (prisma migrate deploy, seed); tam kaynak ve bağımlılıklar
# Gizli değerler imaja girmez; çalışma anında ortam değişkeni olarak verilir.

FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@11.10.0 --activate
WORKDIR /app

# ─── Bağımlılıklar ───
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ─── Derleme ───
FROM deps AS build
COPY . .
# Derleme sırasında modüller yüklenirken ortam doğrulaması geçsin diye yer tutucu değerler (bağlantı kurulmaz)
ARG BUILD_DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN pnpm exec prisma generate \
  && DATABASE_URL=$BUILD_DATABASE_URL REDIS_URL=redis://127.0.0.1:6379 \
     FIELD_ENCRYPTION_KEY=buildbuildbuildbuildbuildbuildbuildbuildbuild= \
     BLIND_INDEX_KEY=buildbuildbuildbuildbuildbuildbuildbuildbuild= \
     pnpm build

# ─── Uygulama ───
FROM base AS app
# Bellek: büyük içe aktarmaların önizleme/uygulaması işçide çalışır; uygulama yalnız yükleme ve ayrıştırma yapar (docs/12 §2)
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/app/storage NODE_OPTIONS=--max-old-space-size=2048
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]

# ─── İşçi ve araçlar ───
FROM build AS worker
# 500k satır önizlemede ölçülen tepe bellek ~1,8 GB (scripts/perf); pay bırakılır
ENV NODE_ENV=production STORAGE_DIR=/app/storage NODE_OPTIONS=--max-old-space-size=6144
RUN mkdir -p /app/storage && chown -R node:node /app/storage /app/.next
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["pnpm", "worker:prod"]
