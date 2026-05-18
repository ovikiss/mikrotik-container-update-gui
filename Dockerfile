FROM node:20-alpine
LABEL org.opencontainers.image.source="https://github.com/ovikiss/mikrotik-container-update-gui"

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY app ./app

ENV NODE_ENV=production
ENV HTTP_PORT=8090

EXPOSE 8090

CMD ["node", "src/server.js"]
