# Patches: the web app (built with Node) served by its Python API. One container (AmberX AXF web-fastapi-wall).
#   docker build -t patches-web .
#   docker run -p 7290:7290 -e APP_TOKEN=… patches-web
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY server server
COPY --from=web /app/dist dist
ENV APP_DATA_DIR=/data PORT=7290
RUN useradd -r -u 1000 -m app && mkdir -p /data && chown app /data
USER app
EXPOSE 7290
# exec: uvicorn gets SIGTERM from `docker stop` and shuts down cleanly
CMD ["sh", "-c", "cd server && exec uvicorn main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
