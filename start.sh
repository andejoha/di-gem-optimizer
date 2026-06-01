#!/usr/bin/env bash
set -euo pipefail

export PORT="${PORT:-8080}"

envsubst '$PORT' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

cd /app/backend
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2 &
UVICORN_PID=$!

nginx -g 'daemon off;' &
NGINX_PID=$!

wait -n $UVICORN_PID $NGINX_PID
EXIT_CODE=$?

echo "A process exited with code $EXIT_CODE. Shutting down..."
kill $UVICORN_PID $NGINX_PID 2>/dev/null || true
wait $UVICORN_PID $NGINX_PID 2>/dev/null || true
exit $EXIT_CODE
