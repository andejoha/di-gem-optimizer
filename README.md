# Diablo Immortal Legendary Gem Optimizer

Optimizes the assignment of inventory gems into awakening sockets of equipped gems, minimizing the gem power drawn from the player's pool. Uses a greedy closest-fit heuristic — assigning the gem whose provided power best matches each main gem's remaining cost — followed by bonus-targeting socket fills and intra-gem reordering to maximize resonance bonus activations.

The optimizer runs entirely in your browser (in a Web Worker, so the UI stays responsive during the heaviest upgrade-search runs) — there is no backend server. The app is a static site: build it, host the files anywhere, done.

## Static hosting (no Docker required)

```bash
npm install
npm run build
```

This produces `dist/` — a set of static files deployable to any static host (Azure Static Web Apps, GitHub Pages, Netlify, S3 + CloudFront, a plain nginx box, etc.). Configure your host's SPA fallback to serve `index.html` for unknown paths (equivalent to `try_files $uri $uri/ /index.html` — see `nginx.conf.template` for the reference configuration this project uses in Docker).

## Docker

A thin `nginx:alpine` image serving the built static files, for environments that expect a container (e.g. Azure App Service Web App for Containers). Requires [Docker](https://docs.docker.com/get-docker/).

**Build and run**

```bash
docker compose up -d --build
```

The app is now available at `http://localhost:8080`.

**Stop**

```bash
docker compose down
```

**Build and run manually**

```bash
docker build -t gem-optimizer .
docker run -p 8080:8080 gem-optimizer
```

**Environment variables**

| Variable | Default | Description                                                    |
| -------- | ------- | -------------------------------------------------------------- |
| `PORT`   | `8080`  | Port nginx listens on. Set automatically by Azure App Service. |

**Multi-architecture build**

_Using Docker_

```bash
docker buildx build --platform linux/arm64,linux/amd64 -t di-gem-optimizer:latest .
```

_Using Docker Compose_

```bash
docker compose build
```

_Using Podman_

```bash
podman build --platform linux/arm64,linux/amd64 --manifest di-gem-optimizer:latest .
```

**Push to Docker Hub**

_Using Docker_ — log in and build+push in one step (required for multi-arch):

```bash
docker login
```

```bash
docker buildx build --platform linux/arm64,linux/amd64 --push -t docker.io/andejoha/di-gem-optimizer:latest .
```

_Using Podman_ — log in first:

```bash
podman login docker.io
```

```bash
podman manifest push di-gem-optimizer:latest docker://docker.io/andejoha/di-gem-optimizer:latest
```

**Azure App Service**

Push the image to Azure Container Registry and deploy it as a Web App for Containers. Set the health check path to `/healthz` in the App Service configuration — **not** `/` or any other app route: with the SPA fallback in place, any unknown path returns the HTML shell with a 200, so a probe against `/` would report healthy even if the app were broken. `/healthz` is a real static endpoint that only nginx itself can serve.

---

## Developing

**Prerequisites:** Node.js 18+

```bash
npm install
npm run dev
```

The app is now available at `http://localhost:5173`.

**Tests**

```bash
npm test
```

The optimizer core (`src/core/`) has no dependency on React, the DOM, or a worker — it can be imported and called directly from a script or test, same as any other TypeScript module.
