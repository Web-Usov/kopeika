# --- Build: the Mini App (static files) and the server (one bundled JS file) ---
# The output is plain JS/HTML, so this stage always runs natively, even for multi-arch builds.
FROM --platform=$BUILDPLATFORM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
# Version info comes from CI (git describe / commit SHA); local builds fall back to dev / unknown.
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ENV APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA
RUN npm run build

# --- Runtime: no node_modules needed, everything is bundled; SQLite is built into Node ---
FROM node:24-slim
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$GIT_SHA
WORKDIR /app
ENV APP_VERSION=$APP_VERSION \
    GIT_SHA=$GIT_SHA \
    NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/kopeika.db \
    STATIC_DIR=/app/web/dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "--disable-warning=DEP0040", "--disable-warning=DEP0169","server/dist/index.js"]
