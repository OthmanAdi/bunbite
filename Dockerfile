FROM oven/bun:1.3.14

WORKDIR /app

# Copy server code
COPY server/ ./server/
COPY public/ ./public/

WORKDIR /app/server
RUN bun install

WORKDIR /app
EXPOSE 3000

CMD ["bun", "run", "server/server.ts"]
