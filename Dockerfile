# ──────────────────────────────────────────────────────────────
# Stage 1: Build React frontend
# ──────────────────────────────────────────────────────────────
FROM node:22-slim AS frontend-builder

WORKDIR /app/src/web/frontend

# Copy manifests first — npm ci layer is cached until package-lock.json changes
COPY src/web/frontend/package.json src/web/frontend/package-lock.json ./
# --force: openapi-typescript@7's typescript peer range (^5.x) lags this
# repo's typescript ~6.0.2; matches the --force install used to generate
# package-lock.json (see commit 0d49c86)
RUN npm ci --force

# Copy remaining frontend source and build
COPY src/web/frontend/ ./
RUN npm run build
# Output lands at /app/src/web/dist (vite outDir is '../dist' relative to frontend dir)

# ──────────────────────────────────────────────────────────────
# Stage 2: Python runtime — no Node.js, no build tools
# ──────────────────────────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ src/
COPY scripts/ scripts/
COPY config.example.yaml config.example.yaml

# Pull compiled frontend assets from builder stage
COPY --from=frontend-builder /app/src/web/dist src/web/dist

RUN mkdir -p logs /data

CMD ["python3", "src/main.py"]
