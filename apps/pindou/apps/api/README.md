# Pindou API

FastAPI service that converts an uploaded image into a square MARD bead grid. MVP1 is stateless, uses the pass-through image enhancer, and returns JSON only.

## Setup

```bash
cd apps/api
python3 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/python -m pip install pytest httpx ruff
```

## Run

```bash
.venv/bin/fastapi dev
```

OpenAPI is available at `http://127.0.0.1:8000/docs`.

## Check

```bash
.venv/bin/ruff check src tests
.venv/bin/pytest -q
```

## API examples

List MARD color sets:

```bash
curl http://127.0.0.1:8000/api/v1/color-sets
```

Convert an image:

```bash
curl -X POST http://127.0.0.1:8000/api/v1/conversions \
  -F 'image=@/absolute/path/source.png' \
  -F 'grid_size=52' \
  -F 'max_colors=18' \
  -F 'color_set_size=48' \
  -F 'background_mode=keep'
```

All returned palette codes are guaranteed to belong to the selected MARD color set.
