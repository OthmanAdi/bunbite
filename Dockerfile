# BunBite has zero production package dependencies. Keep a build-only frozen
# lockfile gate, but do not carry its cache or node_modules into the runtime.
FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS dependency-check
WORKDIR /app/server
COPY server/package.json server/bun.lock ./
RUN bun install --production --frozen-lockfile --ignore-scripts \
    && test ! -e node_modules/@types/bun \
    && test ! -e node_modules/bun-types

# Build a tiny static PID 1 helper. The final runtime is `scratch`, so the
# vulnerable BusyBox binary from Alpine cannot enter the shipped image. The
# helper performs the narrowly required volume ownership repair, drops to Bun's
# fixed UID/GID 1000, and execs Bun directly as PID 1.
FROM alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce AS entrypoint-build
# All compiler inputs are exact Alpine v3.22 package versions. Do not replace
# this list with `build-base` or an unpinned package install: that would make
# the static PID 1 binary depend on mutable repository resolution.
RUN apk add --no-cache \
    binutils=2.44-r3 \
    gcc=14.2.0-r6 \
    gmp=6.3.0-r3 \
    isl26=0.26-r1 \
    jansson=2.14.1-r0 \
    libatomic=14.2.0-r6 \
    libgcc=14.2.0-r6 \
    libgomp=14.2.0-r6 \
    libstdc++=14.2.0-r6 \
    mpc1=1.3.1-r1 \
    mpfr4=4.2.1_p1-r0 \
    musl-dev=1.2.5-r12 \
    zstd-libs=1.5.7-r0
WORKDIR /build
COPY docker-entrypoint.c ./
RUN cc -static -Os -s -Wall -Wextra -Werror -D_DEFAULT_SOURCE -D_XOPEN_SOURCE=700 \
    -o bunbite-entrypoint docker-entrypoint.c \
    && mkdir -p /empty-data /runtime-etc /rootfs/tmp \
    && chmod 01777 /rootfs/tmp \
    && printf 'root:x:0:0:root:/root:/sbin/nologin\nbun:x:1000:1000:Bun runtime:/home/bun:/sbin/nologin\n' > /runtime-etc/passwd \
    && printf 'root:x:0:\nbun:x:1000:\n' > /runtime-etc/group \
    && sha256sum docker-entrypoint.c > /build/entrypoint-source.sha256 \
    && sha256sum bunbite-entrypoint > /build/entrypoint.sha256 \
    && test -x bunbite-entrypoint

# Keep the Bun binary and its verified musl runtime libraries in a named
# source stage. Only the explicit files copied below are present in release.
FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS bun-runtime

# Referencing the build-only stage as a read-only bind makes the frozen
# dependency gate mandatory without copying its cache into the runtime. The
# check runs in an Alpine stage because `scratch` intentionally has no shell.
FROM bun-runtime AS dependency-gate
RUN --mount=from=dependency-check,source=/app/server,target=/dependency-check,ro \
    test -f /dependency-check/package.json \
    && touch /dependency-gate-passed

# The release image deliberately has no Linux distribution base or shell. It
# retains only Bun's exact pinned amd64-compatible runtime and dependencies.
FROM scratch AS runtime
WORKDIR /app

# Copy only the public hosted server source plus the static frontend. Package
# and lock bytes remain in the runtime for release traceability. Billing and
# server/test are absent by construction, including in a public export where
# server/lib/billing.ts does not exist.
COPY --chown=1000:1000 server/package.json server/bun.lock server/server.ts ./server/
COPY --chown=1000:1000 server/lib/db.ts server/lib/optimizer.ts server/lib/ratelimit.ts ./server/lib/
COPY --chown=1000:1000 public/ ./public/
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
COPY --from=bun-runtime /lib/ld-musl-x86_64.so.1 /lib/ld-musl-x86_64.so.1
COPY --from=bun-runtime /usr/lib/libstdc++.so.6 /usr/lib/libstdc++.so.6
COPY --from=bun-runtime /usr/lib/libgcc_s.so.1 /usr/lib/libgcc_s.so.1
COPY --from=entrypoint-build /build/bunbite-entrypoint /usr/local/bin/bunbite-entrypoint
COPY --from=entrypoint-build /build/entrypoint-source.sha256 /usr/share/bunbite/entrypoint-source.sha256
COPY --from=entrypoint-build /build/entrypoint.sha256 /usr/share/bunbite/entrypoint.sha256
COPY --from=entrypoint-build /empty-data/ /data/
COPY --from=entrypoint-build /rootfs/ /
COPY --from=entrypoint-build /runtime-etc/passwd /etc/passwd
COPY --from=entrypoint-build /runtime-etc/group /etc/group
# This zero-byte marker makes the frozen-lockfile dependency gate a required
# ancestor of the final target without carrying its package cache or tools.
COPY --from=dependency-gate /dependency-gate-passed /usr/share/bunbite/.dependency-gate-passed

# SQLite lives on the mounted Fly volume (/data); see fly.toml. The public
# runtime makes no outbound TLS requests, so the scratch image carries no CA
# bundle or billing-only runtime input.
ENV PORT=3000
ENV DB_PATH=/data/bunbite.sqlite
# TRUST_PROXY is deliberately NOT baked into the image: a bare `docker run` has no
# trusted proxy, so forwarding headers must be ignored by default. The Fly deploy
# sets TRUST_PROXY=1 in fly.toml [env], where the edge really does terminate TLS.

EXPOSE 3000

# Start as root only to repair provider-volume ownership. The static fail-closed
# entrypoint then drops to UID/GID 1000 and execs Bun as PID 1.
USER root
ENTRYPOINT ["/usr/local/bin/bunbite-entrypoint"]
CMD ["/usr/local/bin/bun", "run", "server/server.ts"]
