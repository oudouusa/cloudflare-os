FROM node:22.14.0-bookworm@sha256:e5ddf893cc6aeab0e5126e4edae35aa43893e2836d1d246140167ccc2616f5d7 AS truststore

FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
ENV NODE_ENV=development

RUN corepack enable \
    && corepack prepare pnpm@11.17.0 --activate \
    && mkdir -p /workspace/.wrangler /pnpm/store \
    && chown -R node:node /workspace /pnpm

WORKDIR /workspace
USER node

COPY --chown=node:node . .

RUN pnpm install --frozen-lockfile \
    && pnpm build \
    && test "$(find . -name node_modules -prune -o -type l -print | wc -l)" -eq 23 \
    && find . -name node_modules -prune -o -type l -exec test -e {} \;

# node:bookworm-slim does not contain Debian's CA trust store. Node fetch() still
# works because Node carries its own roots, but Wrangler's workerd uses the
# system store for outbound HTTPS. Copy the bundle, hashed links, and link
# targets from a digest-pinned matching Node image instead of disabling TLS
# verification. Keep this after the application build so trust-store refreshes
# do not invalidate the much larger dependency/build layer.
COPY --from=truststore /usr/share/ca-certificates /usr/share/ca-certificates
COPY --from=truststore /etc/ssl/certs /etc/ssl/certs

RUN test -s /etc/ssl/certs/ca-certificates.crt \
    && test "$(find /etc/ssl/certs -maxdepth 1 -type l | wc -l)" -gt 0

EXPOSE 8877

CMD ["node", "run-dev-server.js", "--serve-frontend-assets"]
