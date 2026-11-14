# AmberX public site. Build context = the repository root (Coolify: base directory "/", Dockerfile
# "apps/amberx-site/Dockerfile"), or the slim context deploy.sh stages with the same paths.
FROM node:22-alpine
WORKDIR /app
COPY framework/ui/axf.css framework/ui/axf.css
COPY framework/core/engines/scale-rules.mjs framework/core/engines/scale-rules.mjs
COPY framework/assets/color-theme framework/assets/color-theme
COPY framework/assets/style-theme framework/assets/style-theme
COPY framework/assets/typography framework/assets/typography
COPY framework/assets/density framework/assets/density
COPY framework/assets/sizing framework/assets/sizing
COPY apps/amberx-site apps/amberx-site
RUN rm -rf apps/amberx-site/data apps/amberx-site/baked \
 && node apps/amberx-site/bake.mjs \
 && mkdir -p /data && chown node:node /data
ENV PORT=8080 DATA_DIR=/data NODE_ENV=production
VOLUME /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "apps/amberx-site/server.mjs"]
