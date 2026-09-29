FROM node:22-slim

WORKDIR /app

# Skip husky's git-hook install (no .git in the build context) so `npm ci`
# doesn't fail; scripts still run normally otherwise (postinstall's
# `prisma generate` is unaffected).
ENV HUSKY=0

# Prisma's engine needs OpenSSL, which isn't in the base slim image.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy the whole context (not just package.json) before `npm ci` — its
# `postinstall` runs `prisma generate`, which needs `prisma/schema.prisma`
# to already be present.
COPY . .
RUN npm ci

RUN npm run build

EXPOSE 4000

# Apply pending Prisma migrations, then start the compiled server, so
# `docker compose up` needs no manual step. On Render the pre-deploy command
# runs the same migration first, making this a no-op there.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
