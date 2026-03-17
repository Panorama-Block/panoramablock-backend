FROM node:18-alpine AS builder

WORKDIR /app

# Native deps (thirdweb/metamask deps include native modules like bufferutil)
RUN apk add --no-cache python3 py3-setuptools make g++

# Copy package files (sem lockfile para evitar conflitos de integridade no CI)
COPY liquid-swap-service/package.json ./package.json
RUN npm install --legacy-peer-deps --force

# Copy shared directory (from backend root context)
COPY shared ./shared

# Copy source code
COPY liquid-swap-service/. .

# Build TypeScript
RUN npm run build

# Remove dev dependencies after building to keep image lean
RUN npm prune --omit=dev

# Runtime stage (keeps image lean, no build toolchain)
FROM node:18-alpine AS runner

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/shared ./shared

# Expose port
EXPOSE 3002

# Run the application
CMD ["npm", "start"]
