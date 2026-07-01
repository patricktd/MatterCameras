FROM node:22-alpine

RUN apk add --no-cache python3 make g++ gcc tzdata git docker-cli docker-cli-compose bash

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY views ./views
COPY public ./public

RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV MATTER_CAMERAS_MANAGED_RESTART=1
ENV storage.path=/app/data

# Release metadata (set by CI / scripts/release-version.mjs --local-images).
# Placed last so changing the version does not bust the npm/build layer cache.
ARG VERSION=dev
ARG VCS_REF=
LABEL org.opencontainers.image.title="Matter Cameras Bridge" \
      org.opencontainers.image.description="Bridge RTSP/ONVIF cameras as Matter 1.5 camera endpoints" \
      org.opencontainers.image.source="https://github.com/patricktd/MatterCameras" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.licenses="ISC"

CMD ["node", "dist/main.js"]
