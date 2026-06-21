FROM node:24.17.0-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY prisma ./prisma
COPY eslint.config.js jest.config.js tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY test ./test
COPY scripts ./scripts
RUN npm run prisma:generate && npm run build

FROM node:24.17.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/src ./src
COPY --chown=node:node --from=build /app/test ./test
COPY --chown=node:node --from=build /app/scripts ./scripts
COPY --chown=node:node --from=build /app/eslint.config.js /app/jest.config.js /app/tsconfig.json /app/tsconfig.build.json ./
COPY --chown=node:node package.json package-lock.json ./
USER node
CMD ["npm", "run", "start:api"]
