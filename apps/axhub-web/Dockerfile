# The AXHub web app: built with Node, served as static files by nginx. It holds no hub token: the browser reads the
# hub with its own session, so the container only serves files.
#   docker build -t axhub-web .
#   docker run -p 7390:8080 axhub-web
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web /app/dist /usr/share/nginx/html
EXPOSE 8080
