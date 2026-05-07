FROM node:18-bullseye

WORKDIR /app

COPY backend/service/package.json backend/service/package.json

WORKDIR /app/backend/service
RUN npm install --omit=dev

WORKDIR /app
COPY src/main src/main
COPY backend/service/server.js backend/service/server.js

EXPOSE 8787
WORKDIR /app/backend/service
CMD ["npm", "start"]

