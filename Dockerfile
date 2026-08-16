# ============================================================
# Stage 1: Build the React frontend
# ============================================================
FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ============================================================
# Stage 2: Static nginx runtime
# ============================================================
# The optimizer runs entirely in the browser (see frontend/src/core/) --
# there is no backend process to run alongside nginx anymore.
FROM nginx:1.27-alpine AS runtime

COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
RUN chmod -R a+rX /usr/share/nginx/html

# The base image's entrypoint runs envsubst over every file in
# /etc/nginx/templates/*.template into /etc/nginx/conf.d/ before starting
# nginx, so ${PORT} interpolation (set automatically by Azure App Service)
# needs no custom start script.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

ENV PORT=8080
EXPOSE 8080
