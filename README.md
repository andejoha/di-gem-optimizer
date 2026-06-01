# Diablo Immortal Legendary Gem Optimizer

Optimizes the assignment of inventory gems into awakening sockets of equipped gems, minimizing the gem power drawn from the player's pool. Uses Integer Linear Programming (ILP) to find the optimal assignment, followed by greedy heuristics to maximize resonance bonus activations.

## Docker (recommended for deployment)

Bundles the frontend and backend into a single container. Requires [Docker](https://docs.docker.com/get-docker/).

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

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Port nginx listens on. Set automatically by Azure App Service. |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated list of allowed CORS origins. Not needed when the frontend and backend are served from the same origin (i.e. in Docker). |

**Azure App Service**

Push the image to Azure Container Registry and deploy it as a Web App for Containers. Set the health check path to `/api/health` in the App Service configuration.

---

## Starting the frontend

**Prerequisites:** Node.js 18+

**1. Install dependencies (first time only)**

```bash
cd frontend
npm install
```

**2. Start the dev server**

```bash
npm run dev
```

The frontend is now available at `http://localhost:5173`.

> The backend must also be running for the frontend to connect successfully (see below).

## Starting the API server

**Prerequisites:** Python 3.12+

**1. Create and activate a virtual environment (first time only)**

```bash
python -m venv .venv
source .venv/bin/activate       # Linux / macOS
# .venv\Scripts\activate        # Windows
```

**2. Install dependencies (first time only)**

```bash
pip install -r backend/requirements.txt
```

**3. Start the server**

```bash
cd backend
uvicorn app.main:app --host localhost --port 8000 --reload
```

The API is now available at `http://localhost:8000`.

## CLI tool

The CLI calls the same functions as the API endpoints — no server required. Run all commands from the `backend/` directory with the virtual environment activated.

```bash
cd backend
```

**Health check**

```bash
python cli.py health
```

**List all gems** (IDs, names, star ratings, bonus socket requirements)

```bash
python cli.py gem-data
```

**Run the optimizer**

Pass the request body as an inline JSON string or a path to a JSON file:

```bash
# Inline JSON
python cli.py optimize '{"gem_power": 772, "gem_setup": {"head": {"gem_id": 5018, "target_rank": "5", "active_stars": 4}}, "inventory": [{"gem_id": 5007, "rank": "1", "active_stars": 2}]}'

# JSON file
python cli.py optimize request.json

# With optional flags
python cli.py optimize request.json --enable_upgrades --convert_1star
```

Flags:
- `--enable_upgrades` — analyse profitable gem upgrades and re-run with the upgraded inventory
- `--convert_1star` — convert rank-1 1-star inventory gems into gem power before optimizing

**Decode a frontend import string**

The frontend's import/export feature produces a compact base64url string. Use `decode` to convert it to an `OptimizeRequest` JSON body:

```bash
python cli.py decode <import_string>
```

The output can be piped directly into `optimize`:

```bash
python cli.py decode <import_string> | python cli.py optimize - --enable_upgrades
```

Or saved to a file first:

```bash
python cli.py decode <import_string> > request.json
python cli.py optimize request.json
```

## API reference

Interactive Swagger UI: `http://localhost:8000/docs`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/optimize` | Run the gem optimizer |
| `GET` | `/api/gem-data` | List of known gem names by star rating (for autocomplete) |

### POST /api/optimize

**Query parameters:**
- `enable_upgrades` (bool, default `false`) — also analyse profitable gem upgrades and re-run the optimizer with the upgraded inventory.
- `convert_1star` (bool, default `false`) — convert rank-1 1-star inventory gems into gem power before optimizing.

**Request body:**

```json
{
  "gem_power": 772,
  "gem_setup": {
    "head":      { "gem_id": 5018, "target_rank": "5",   "active_stars": 4 },
    "chest":     { "gem_id": 5007, "target_rank": "4.1", "active_stars": 3 },
    "shoulders": { "gem_id": 5024, "target_rank": "4",   "active_stars": 3 }
  },
  "inventory": [
    { "gem_id": 5007, "rank": "1", "active_stars": 2 },
    { "gem_id": 2025, "rank": "5", "active_stars": 2 }
  ]
}
```

- `gem_power` — the player's available gem power pool.
- `gem_setup` — equipped gems per slot. Supported slots: `head`, `chest`, `shoulders`, `legs`, `main_hand`, `off_hand`, `alt_main_hand`, `alt_off_hand`. Omitted slots are skipped.
- `inventory` — socketable gem copies. Each entry is one physical copy; add duplicate entries for multiple copies of the same gem. Use `GET /api/gem-data` to look up gem IDs.
