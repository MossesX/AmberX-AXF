# Walkthrough Studio: a static web app (AmberX AXF react-ts) served by nginx. Built from this folder.
#   docker build -t walkthrough-studio .
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web /app/dist /usr/share/nginx/html
EXPOSE 8080
