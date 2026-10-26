# AmberX web app: built with Node, served as static files by nginx at https://amberx.amberxai.com. The Android shell
# (android/, Capacitor) loads this address, so the app and axHub share one sign-in (the hub cookie domain amberxai.com).
# It holds no token: every hub call uses the signed-in hub session.
#   docker build -t amberx-web .
#   docker run -p 7491:8080 amberx-web
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
