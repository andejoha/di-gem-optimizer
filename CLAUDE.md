# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, client-only React app (Diablo Immortal Legendary Gem Optimizer) that assigns inventory
gems into awakening sockets to minimize the gem power drawn from the player's pool. There is no
backend; the entire optimizer runs in the browser inside a Web Worker so the heaviest upgrade-search
runs don't freeze the UI. `src/core/` has no dependency on React, the DOM, or the worker — it's
plain TypeScript, importable and testable directly.

The game rules the optimizer is meant to encode (gem power, sockets, resonance, bonus activation,
upgrades) are specified independently of the implementation in `docs/SPEC.md` — consult it when a
change is about _what the app should do_, not just how the current code does it.

## Commands

```bash
npm run dev            # vite dev server at localhost:5173
npm run build           # tsc -b && vite build -> dist/
npm run lint            # eslint .
npm run format:check    # prettier --check .
npm run format          # prettier --write .
npm test                # vitest run (test/**/*.test.ts)
npm run test:watch      # vitest watch mode
```

Run a single test file: `npx vitest run test/core/optimizer.test.ts`. CI (`.github/workflows/ci.yml`)
runs lint, format:check, build, then test, in that order — match that order locally before pushing.

There are two separate TS project configs: `tsconfig.app.json` (src/, DOM types) and
`tsconfig.test.json` (test/, node types). `vitest.config.ts` runs tests under plain node with no DOM,
separate from `vite.config.ts` which pulls in `@vitejs/plugin-react`.

## Architecture

### Core pipeline (`src/core/`)

`runOptimization` (`src/core/api/runOptimization.ts`) is the single entry point: parses/validates
the request, runs the baseline pipeline, and — when upgrades are enabled — searches for the most
cost-effective set of gem upgrades before producing the response. It's called from both the worker
(`src/workers/optimizer.worker.ts`, the primary path) and directly as a synchronous main-thread
fallback (`src/services/gemApi.ts`'s `optimize()`, dynamically imported so the optimizer's dependency
graph doesn't land in the main bundle chunk).

`runPipeline` (`src/core/pipeline.ts`) runs three phases per invocation, in order:

1. **Greedy assignment** (`solveAssignment` in `optimizer.ts`) — closest-fit heuristic assigning
   each inventory gem copy to the 5-star main gem socket whose remaining cost it best matches.
2. **Empty socket fill** (`fillEmptySockets`) — fills any sockets the greedy pass left empty
   (including all 1/2-star main gem sockets, which start empty), highest-resonance gem first.
3. **Socket materialization** (`assignSockets`) — distributes each main gem's already-decided set
   of copies across its own sockets to maximize activated bonuses, without changing which copies
   were assigned to that main gem.

Bonus activation is not a separate optimization phase — it's folded into phases 1–2 as a tie-break:
when several candidate copies are numerically indistinguishable (same contribution, same active
stars), the one that activates the target socket's bonus wins, and failing that, one not still
needed as a bonus gem by another main gem (see `computeBonusGemDemand`/`pickWithBonusTieBreak` in
`optimizer.ts`). Phase 3 then resolves, for free, which socket within a main gem each already-chosen
copy lands in. See docs/SPEC.md ("Bonus activation") for the rule this encodes — it never trades gem
power or resonance for a bonus.

The upgrade search in `runOptimization` treats two-star and five-star upgrade chains differently:
two-star chains are fully exhausted before touching any five-star chain, because five-star gems have
a much higher gem-power-per-upgrade-cost ratio. It walks upgrade depth downward from maximum,
re-running `runPipeline` at each candidate depth, until it finds a depth combination whose net
residual (effective residual minus recoverable dormant power) fits within the available power pool.
That winning candidate's result is used directly for display.

Other core modules:

- `models.ts` — domain types (`MainGem`, `InventoryGem`, `SocketAssignment`, `OptimizationResult`)
  and their `make*` constructors.
- `rules.ts` — game-rule computations (extractable power, slot resonance).
- `data.ts` / `constants.ts` — the static gem catalog and cost tables.
- `upgrades.ts` — builds upgrade chains from inventory and materializes a chosen depth combination
  into a working inventory.
- `progress.ts` — `ProgressReporter` abstraction; `nullReporter` for tests/sync calls,
  `makeCallbackReporter` for the worker to stream stage events back to the main thread.
- `api/` — the request/response boundary: `types.ts` (wire types, snake_case), `converters.ts`
  (domain <-> wire conversion), `validate.ts` (`ValidationError`).

### Worker boundary

`src/workers/optimizer.worker.ts` is the only consumer of `runOptimization` on the hot path.
Messages are correlated by an incrementing `id` so stale replies from a superseded request (the user
changed input and re-ran before the previous run finished) are ignored by `gemApi.ts`. On a worker
`error` event or an `error`-typed response, `gemApi.ts` terminates and drops the worker so a corrupted
state can't poison subsequent runs.

### Frontend

- `src/pages/HomePage.tsx` — gear setup, inventory input, and triggers optimization via
  `optimizeWithProgress` (streams `ProgressEvent`s into `src/components/progress/OptimizationProgress.tsx`).
- `src/pages/ResultsPage.tsx` — renders `OptimizeResponse` (per-slot results, upgrades, dormant/converted
  gems, remaining inventory).
- `src/contexts/GemDataContext.tsx` — provides the gem catalog (fetched via `core/api/gemData.ts`) to
  the component tree.
- `src/utils/setupCodec.ts` — encodes/decodes a gear+inventory setup for import/export
  (`src/components/toolbar/ImportExportDialog.tsx`).

### Golden regression corpus (`test/golden/`)

`test/core/golden.test.ts` runs every `<case>.request.json` through `runOptimization` across all 4
`(enableUpgrades, convert1Star)` flag combinations and diffs the result byte-for-byte against
`<case>.<flags>.expected.json` (or `.error.json` for cases expected to throw `ValidationError`). See
`test/golden/README.md` for corpus composition. **Any intentional change to optimizer behavior must
regenerate the affected `.expected.json` files, with the diff reviewed as carefully as the code
change itself** — an unreviewed regeneration defeats the purpose of the suite.

## Deployment

Static site — `npm run build` produces `dist/`, deployable to any static host. `Dockerfile` +
`nginx.conf.template` package it as `nginx:alpine` for container-based hosts (e.g. Azure App Service
Web App for Containers); see `README.md` for Docker/multi-arch build details. The SPA fallback
(`try_files $uri $uri/ /index.html`) means any unknown path returns 200 — health checks must target
`/healthz`, a real static endpoint, not `/`.
