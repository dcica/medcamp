# Self-hostable image for the dcica platform.
#
# The mandate says "near-one-command deploy, env-configured", and until now
# there was no container at all — the app only ran from a developer's checkout.
#
# Multi-stage on purpose: the build needs devDependencies, the Prisma CLI and
# the full source; the thing that ships needs none of them.

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
# Prisma's engines need this on Alpine.
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
# `npm ci` and not `npm install`: the lockfile is the input, so an image built
# today and one built next month contain the same tree.
RUN npm ci

# ── build ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next.config runs dotenv with override:true, and `next build` evaluates
# src/lib/env.ts. A build-time placeholder keeps validation happy; the REAL
# values arrive at run time, and none of these are baked into the output.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Not root. The container writes nothing it does not have to.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migrations and the Prisma CLI, so a deploy can run `db:migrate:deploy` in the
# same image it serves from — the repo wrapper refuses a schema-less URL, which
# is the check that stopped this project accumulating four copies of itself in
# one Supabase instance.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma

USER nextjs
EXPOSE 3000

# The health endpoint already exists and reads the database, so it is a real
# readiness signal rather than "the process is up".
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
