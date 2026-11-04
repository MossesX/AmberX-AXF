# Browser host for the console's Automated Browser plugin: headless Chromium + a small HTTP/websocket API on :7095.
# Built from this folder:  docker build -t axf-browser apps/console-web/plugins/auto-browser/host
# Run on the console's network, never published:  see ../deploy.sh
FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY *.mjs ./
ENV NODE_ENV=production PORT=7095 AXF_BROWSER_DATA=/data PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /data && chown -R pwuser:pwuser /data /app
USER pwuser
VOLUME /data
EXPOSE 7095
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:7095/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "host.mjs"]
