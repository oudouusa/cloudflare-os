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

EXPOSE 8877

CMD ["node", "run-dev-server.js", "--serve-frontend-assets"]
