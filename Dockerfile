# Spider V Web Control: the built web app plus the server that relays phone
# remote control. The browser talks to the amp over Web MIDI, so the
# container needs no USB access. See README ("Run it in a container").

FROM oven/bun:1-alpine AS build
WORKDIR /src/app
COPY app/package.json app/bun.lock ./
RUN bun install --frozen-lockfile
COPY app/ ./
# Demo mode bundles the recorded session and test catalog from the tests.
COPY test/fixtures/spiderv20-mkii-session.json test/fixtures/test-catalog.json /src/test/fixtures/
RUN bun run build \
 && bun build server.ts --target=bun --outfile=/out/server.js

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=build /out/server.js ./
COPY --from=build /src/app/dist ./dist
ENV PORT=8080
EXPOSE 8080
USER bun
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD ["bun", "-e", "const e = process.env; fetch(`${e.CERT_DIR ? 'https' : 'http'}://127.0.0.1:${e.PORT || 8080}/`, { tls: { rejectUnauthorized: false } }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "server.js"]
