# syntax=docker/dockerfile:1
# pixelagents server image: builds the npm package from this checkout and installs it, nothing else.

FROM node:22-slim AS build
WORKDIR /src
COPY . .
RUN npm ci --no-audit --no-fund \
 && npm run build -w pixelagents \
 && npm pack -w pixelagents --pack-destination /out

FROM node:22-slim
# The tarball is the whole product: bundled server, official plugins, web app and sprites.
COPY --from=build /out/pixelagents-*.tgz /tmp/
RUN npm install -g /tmp/pixelagents-*.tgz --no-audit --no-fund \
 && rm -f /tmp/pixelagents-*.tgz \
 && mkdir -p /data && chown node:node /data

USER node
ENV HOME=/data
WORKDIR /data
VOLUME /data
EXPOSE 4242

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:4242/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# Config, state and uploaded assets live in /data. Listening on 0.0.0.0 needs `server.token` in
# /data/config.json (without it the page is read-only: ingest and config writes are refused).
ENTRYPOINT ["pixelagents"]
CMD ["serve", "--config", "/data/config.json", "--data-dir", "/data", "--host", "0.0.0.0", "--port", "4242"]
