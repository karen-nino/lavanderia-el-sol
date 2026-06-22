FROM node:22-slim

# Herramientas de compilación para módulos nativos (bcrypt) por si no hay binario.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# pnpm 9 (no bloquea los scripts de instalación de bcrypt).
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Instalar dependencias de producción primero (mejor cacheo).
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Copiar el resto del código.
COPY . .

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "index.js"]
