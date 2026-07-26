FROM node:22-alpine AS runtime

RUN apk add --no-cache curl

WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN pnpm config set minimumReleaseAge 0 \
  && pnpm config set dangerouslyAllowAllBuilds true \
  && pnpm install --frozen-lockfile --prod

COPY src ./src

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3001/health || exit 1

CMD ["node", "src/server.js"]
