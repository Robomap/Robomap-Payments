# Build the payments SPA, then serve it from the Python BFF (SSO + static).
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM python:3.13-slim
WORKDIR /app
COPY src/ /app/
COPY --from=web /web/dist /app/web/dist

ENV PORT=80
ENV STATIC_ROOT=/app/web/dist
ENV PYTHONUNBUFFERED=1
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:80/health', timeout=2).read()"

CMD ["python", "-u", "/app/server.py"]
