FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/apps/api/src
WORKDIR /app/apps/api

RUN addgroup --system --gid 10001 pindou \
    && adduser --system --uid 10001 --ingroup pindou pindou

COPY apps/api/pyproject.toml /app/apps/api/pyproject.toml
COPY apps/api/src /app/apps/api/src
COPY apps/api/migrations /app/apps/api/migrations
COPY apps/api/alembic.ini /app/apps/api/alembic.ini
COPY docs/MARD_色卡.json /app/docs/MARD_色卡.json

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir /app/apps/api \
    && mkdir -p /var/lib/pindou/images \
    && chown -R pindou:pindou /app /var/lib/pindou

USER pindou
EXPOSE 8000
CMD ["uvicorn", "pindou.main:app", "--host", "0.0.0.0", "--port", "8000"]
