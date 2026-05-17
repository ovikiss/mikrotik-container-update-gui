FROM node:20-alpine
LABEL org.opencontainers.image.source="https://github.com/ovikiss/mikrotik-container-update-gui"

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3030

EXPOSE 3030

CMD ["node", "src/server.js"]
