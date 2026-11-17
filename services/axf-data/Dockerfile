# axf-data: the container that holds all console data (data-store@1). Private: no published port, no domain; it sits
# on the internal `axf-data` docker network. Its store is Postgres in its own container (axf-data-db, volume
# axf-data-pg) when AXF_DATA_DSN is set; the named volume `axf-data` (mounted at /data) keeps snapshots, the engine
# state and the SQLite store of an install that has not moved yet.
# Build context = this folder plus framework/schemas/data-store.json copied next to store.py (deploy/install-data.sh
# does that), so the image carries the same registry the clients check against.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 AXF_DATA_DIR=/data AXF_DATA_PORT=7700
WORKDIR /app
# postgresql-client 16 (pg_dump / pg_restore for backup.py; same major as the axf-data-db image) from the PGDG repo
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y --auto-remove curl gnupg && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && useradd --uid 10001 --create-home axfdata \
 && mkdir -p /data && chown axfdata:axfdata /data
COPY --chown=axfdata:axfdata . .
RUN test -f /app/data-store.json || (echo "data-store.json missing from the build context" && exit 1)
USER axfdata
VOLUME ["/data"]
EXPOSE 7700
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:7700/v1/health', timeout=4).status == 200 else 1)"
# One worker: writes serialise in-process (one lock, one database connection).
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7700", "--workers", "1", "--log-level", "warning"]
