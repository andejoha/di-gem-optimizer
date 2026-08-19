# Mac's Gem Optimizer

A **Diablo Immortal** legendary gem optimizer. Optimizes the assignment of inventory gems into awakening sockets of equipped gems, minimizing the gem power drawn from the player's pool. Uses a greedy closest-fit heuristic — assigning the gem whose provided power best matches each main gem's remaining cost — followed by bonus-targeting socket fills and intra-gem reordering to maximize resonance bonus activations.

The optimizer runs entirely in your browser (in a Web Worker, so the UI stays responsive during the heaviest upgrade-search runs) — there is no backend server. The app is a static site: build it, host the files anywhere, done.

## Static hosting (no Docker required)

```bash
npm install
npm run build
```

This produces `dist/` — a set of static files deployable to any static host (Azure Static Web Apps, GitHub Pages, Netlify, S3 + CloudFront, a plain nginx box, etc.). Configure your host's SPA fallback to serve `index.html` for unknown paths (equivalent to `try_files $uri $uri/ /index.html` — see `nginx.conf.template` for the reference configuration this project uses in Docker).

If the app is served from a subpath rather than the domain root (e.g. a GitHub Pages project page),
build with `VITE_BASE=/<subpath>/ npm run build` so Vite emits asset URLs and the router basename
correctly.

## GitHub Pages

Live at [andejoha.github.io/macs-gem-optimizer](https://andejoha.github.io/macs-gem-optimizer/), deployed
by `.github/workflows/pages.yml`, which builds with `VITE_BASE=/macs-gem-optimizer/` and publishes
`dist/` via the GitHub Pages Actions integration (repo Settings → Pages → Source: GitHub Actions).

### Releases

Not every push to `main` deploys. The workflow only ships (and cuts a `vX.Y.Z` release) when the
commit title starts with:

- `feature` — bumps the **minor** version (new functionality)
- `hotfix` — bumps the **patch** version (a fix)

Any other commit title is skipped entirely — no build, no deploy. Since merging a PR with squash
merge uses the PR title as the commit title, that title is what has to start with `feature`/`hotfix`
to ship.

Bumping the **major** version requires manually running the workflow (Actions → Deploy to GitHub
Pages → Run workflow) and choosing `major` from the dropdown — the only way to cut one. The dropdown
also offers `minor`/`patch` for a manual run of those.

Each release is published on the [Releases page](../../releases), marked as the latest release, with
auto-generated notes and a `dist.zip` asset — a `VITE_BASE=/` build that can be unzipped and served
from any static host or the domain root.

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
docker buildx build --platform linux/arm64,linux/amd64 -t macs-gem-optimizer:latest .
```

_Using Docker Compose_

```bash
docker compose build
```

_Using Podman_

```bash
podman build --platform linux/arm64,linux/amd64 --manifest macs-gem-optimizer:latest .
```

**Push to Docker Hub**

_Using Docker_ — log in and build+push in one step (required for multi-arch):

```bash
docker login
```

```bash
docker buildx build --platform linux/arm64,linux/amd64 --push -t docker.io/andejoha/macs-gem-optimizer:latest .
```

_Using Podman_ — log in first:

```bash
podman login docker.io
```

```bash
podman manifest push macs-gem-optimizer:latest docker://docker.io/andejoha/macs-gem-optimizer:latest
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

## License

This project is licensed under the terms of the MIT license. See [LICENSE](LICENSE) for details.
