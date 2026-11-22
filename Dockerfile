FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

USER node
EXPOSE 3000
# Run node directly, not through npm, so the platform's SIGTERM reaches the server instead of npm reporting it as a failure.
WORKDIR /app/apps/api
CMD ["node", "src/main.ts"]
