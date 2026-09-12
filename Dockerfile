# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=20-alpine

# ---- deps stage: install all deps (dev + prod) for build ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
RUN npm ci

# ---- build stage: compile TypeScript, generate Prisma client ----
FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

# ---- runtime stage: minimal image ----
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
# Non-root user
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
# Migrations are applied at startup so a fresh `docker compose up` gives a working DB.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
