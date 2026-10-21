FROM python:3.13-slim

WORKDIR /app
COPY src/server.py /app/server.py

# Port 80 matches the Container Apps hello-world placeholder, so the ingress
# probe stays valid when this image replaces it. Binding port 80 requires root.
ENV PORT=80
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:80/health', timeout=2).read()"

CMD ["python", "-u", "/app/server.py"]
