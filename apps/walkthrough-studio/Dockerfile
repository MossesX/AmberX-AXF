# Walkthrough Studio: built with Node, served as static files by nginx. It holds no token: projects live in the
# browser, or on axHub's data server read with the browser's own hub session.
#   docker build -t walkthrough-web .
#   docker run -p 7490:8080 walkthrough-web
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
