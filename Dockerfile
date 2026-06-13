FROM oven/bun:1.3.14

WORKDIR /app

# Server + static frontend (zero runtime deps; bun:sqlite is built in)
COPY server/ ./server/
COPY public/ ./public/

WORKDIR /app/server
RUN bun install --production

WORKDIR /app

# SQLite file lives on the mounted Fly volume (/data); see fly.toml.
ENV PORT=3000
ENV DB_PATH=/data/bunbite.sqlite

EXPOSE 3000

CMD ["bun", "run", "server/server.ts"]
