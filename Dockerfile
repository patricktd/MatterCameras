FROM node:22-alpine

RUN apk add --no-cache python3 make g++ gcc tzdata

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

CMD ["node", "dist/main.js"]
