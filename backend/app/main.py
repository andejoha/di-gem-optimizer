"""FastAPI application entry point."""

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router

logging.basicConfig(
    format="%(asctime)s %(levelname)-7s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
    level=logging.INFO,
)

app = FastAPI(
    title="Diablo Immortal Gem Optimizer",
    description=(
        "Assigns inventory gems to awakening sockets of equipped gems using a greedy "
        "closest-fit heuristic to minimise residual gem power cost. Optionally analyses profitable gem upgrades."
    ),
    version="1.0.0",
)

_cors_origins_env = os.getenv("CORS_ORIGINS", "http://localhost:5173")
_cors_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error during optimization."},
    )
