# MPP Relay Server Dockerfile
# For Render, Railway, Fly.io, etc.

FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY tsconfig.json ./
COPY src ./src
COPY public ./public

# Build TypeScript
RUN npm run build

# Environment defaults
ENV NODE_ENV=production
ENV VIEWER_HTTP_PORT=10000
ENV RELAY_WS_PORT=10000
ENV MPP_EMBEDDED_AGENT=false
ENV RELAY_ENABLE_CORS=true

EXPOSE 10000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:10000/healthz || exit 1

CMD ["npm", "run", "relay"]
