# Sanad, as one container.
#
# The database is already elsewhere (any PostgreSQL with pgvector), so this
# image is the web app and nothing else. There is no separate worker process:
# jobs drain inline in the request that creates them, which is what makes a
# single container enough.
#
# Build:  docker build -t sanad .
# Run:    docker run -p 7860:7860 -e DATABASE_URL=... -e APP_SECRET=... sanad
FROM node:22-slim

# ca-certificates for TLS to the database and the model hub; tini so signals
# reach the app and a stop is a stop rather than a timeout.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

WORKDIR /app
COPY . .

# Dev dependencies are needed to build, and the build is part of this image.
RUN pnpm install --frozen-lockfile

# The build must not need a database. If this ever fails for want of one, the
# page that reached for it at build time is the bug, not this line.
RUN pnpm build

# Bake the embedding model in, so a cold start answers immediately and a running
# container never depends on the model hub being reachable.
RUN pnpm exec tsx scripts/warm-embeddings.ts

# Hugging Face Spaces runs as uid 1000 and expects 7860; both are overridable.
ENV NODE_ENV=production \
    PORT=7860 \
    STORAGE_ROOT=/tmp/sanad-storage
RUN mkdir -p /tmp/sanad-storage && chown -R 1000:1000 /app /tmp/sanad-storage
USER 1000

EXPOSE 7860
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "scripts/serve.sh"]
