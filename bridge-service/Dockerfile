# Build stage
FROM node:18-bullseye AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (use npm install to avoid lock mismatches in envs without updated lockfile)
RUN npm install

# Copy source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the application
RUN npm run build

# Remove devDependencies for production image
RUN npm prune --omit=dev

# Production stage
FROM node:18-bullseye AS production

# Create app user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 tacservice

# Set working directory
WORKDIR /app

# Copy built application
COPY --from=builder --chown=tacservice:nodejs /app/dist ./dist
COPY --from=builder --chown=tacservice:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=tacservice:nodejs /app/package.json ./package.json
COPY --from=builder --chown=tacservice:nodejs /app/shared ./shared

# Create logs directory
RUN mkdir -p /app/logs && chown -R tacservice:nodejs /app/logs

# Switch to non-root user
USER tacservice

# Expose ports
EXPOSE 3005 3006

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3005/health', (res) => { \
    process.exit(res.statusCode === 200 ? 0 : 1) \
  }).on('error', () => process.exit(1))"

# Start the application
CMD ["node", "dist/index.js"]

# Development stage
FROM node:18-bullseye AS development

WORKDIR /app

# Install development dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Expose ports
EXPOSE 3005 3006

# Start development server
CMD ["npm", "run", "dev"]
