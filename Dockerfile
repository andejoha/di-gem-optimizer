# ============================================================
# Stage 1: Build the React frontend
# ============================================================
FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

ENV VITE_API_BASE_URL=""
ENV VITE_ENABLE_SHOP=""
ENV VITE_ENABLE_UNLIMITED_SOLVER=""
RUN npm run build

# ============================================================
# Stage 2: Runtime with Python, nginx, and static frontend
# ============================================================
FROM python:3.14-slim AS runtime

RUN apt-get update && \
    apt-get install -y --no-install-recommends nginx gettext-base && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/nginx.conf.template
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/app/start.sh"]
