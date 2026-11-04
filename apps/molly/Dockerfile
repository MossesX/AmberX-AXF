# Molly: one interface for AmberX, axHub and the Dev Console. Built with Node, served as static files by nginx; it holds
# no token (each framed app signs in with its own session, the look comes from axHub in the browser).
#   docker build -t molly .
#   docker run -p 7490:8080 molly
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
