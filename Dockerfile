# Runtime has zero npm dependencies, so the image is just Node + the sources.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json ./
COPY src ./src
COPY public ./public
COPY test/fixtures ./test/fixtures
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["node", "src/main.js"]
