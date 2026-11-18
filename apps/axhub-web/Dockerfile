# The AXHub web app is retired (Nov 18 2026): its pages live in the Dev Console's Hub screens (hub-console@1). This image
# serves only the redirect page that sends the old `#/<route>` addresses to the console's deep links; it holds no hub
# token and runs no app code.
#   docker build -t axhub-web .
#   docker run -p 7390:8080 axhub-web
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/redirect.html /usr/share/nginx/html/redirect.html
EXPOSE 8080
