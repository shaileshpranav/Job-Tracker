# Job Tracker runs straight off TypeScript (Node's built-in type-stripping) with no bundler,
# so this is a single stage: install runtime deps, copy source, run.
FROM node:22-alpine

WORKDIR /app

# Installed separately from the source copy so this layer is only rebuilt when deps change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY templates ./templates

# profile/, data/, applications/ and extensions/ are meant to be volumes (see docker-compose.yml) —
# created here so the app has somewhere to write before a volume is mounted over them.
RUN mkdir -p data applications profile extensions && \
    addgroup -S jobtracker && adduser -S jobtracker -G jobtracker && \
    chown -R jobtracker:jobtracker /app
USER jobtracker

ENV HOST=0.0.0.0 \
    PORT=4321
EXPOSE 4321

# Same command as `npm start`, run directly so SIGTERM reaches Node instead of an npm wrapper.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--env-file-if-exists=.env", "src/server.ts"]
