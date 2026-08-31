# Self-hosting image for the app service (SPEC.md §3 "Packaging").
#
# Three stages:
#   builder  — full install + `next build`
#   migrator — reuses the builder (it already has drizzle-kit, a devDependency)
#              to run migrations as a one-shot compose service
#   runtime  — Next.js standalone output only; no npm, no node_modules install
#
# Migrations deliberately do NOT run from the app's own entrypoint. Two app
# replicas would then race each other on the same schema, and a migration
# failure would present as a crash-looping web server rather than a job that
# stops the rollout. docker-compose.yml runs `migrate` to completion first.
#
# Note that drizzle-kit does not exit non-zero on an unreachable host — it
# hangs, stalling `docker compose up` rather than failing it. That still fails
# closed (the app waits on `service_completed_successfully`), but a stuck `up`
# is the symptom to expect, not an error message.

FROM node:26-alpine AS builder

WORKDIR /app

# Manifests first: this layer is cached until the dependency set changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Migration runner -------------------------------------------------------
# drizzle-kit is a devDependency, so this has to be the builder, not the slim
# runtime. It exits when the migrations are applied; it serves no traffic.
#
# Invoked by path rather than through `npx`: npx falls back to downloading and
# running the registry's latest drizzle-kit when local resolution fails, and in
# a non-TTY container it does so without prompting — remote code with a live
# database credential in its environment. By path, that becomes a loud failure.
FROM builder AS migrator
USER node
CMD ["node_modules/.bin/drizzle-kit", "migrate"]

# --- Runtime ----------------------------------------------------------------
FROM node:26-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
# The standalone server binds to this; without it it listens on localhost only
# and the published port answers with a connection reset.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# `node` (uid 1000) ships with the base image. Running the web server as root
# is the one privilege that buys nothing here.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000

# /login rather than /: the root path redirects for every visitor
# (src/app/page.tsx), and node's http.get does not follow redirects, so a check
# demanding 200 from / would never pass.
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/login',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
