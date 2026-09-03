FROM node:24-alpine

WORKDIR /app

COPY server/ ./server/
COPY client/ ./client/

EXPOSE 5055
ENV PORT=5055

CMD ["node", "server/server.js"]
