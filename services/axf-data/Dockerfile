# axf-data: the container that holds all console data (data-store@1). Private: no published port, no domain; it sits
# on the internal `axf-data` docker network and owns the named volume `axf-data` (mounted at /data).
# Build context = this folder plus framework/schemas/data-store.json copied next to store.py (deploy/install-data.sh
# does that), so the image carries the same registry the clients check against.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 AXF_DATA_DIR=/data AXF_DATA_PORT=7700
WORKDIR /app
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
# One worker: writes serialise in-process (store.py holds the lock and the SQLite connection).
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7700", "--workers", "1", "--log-level", "warning"]
