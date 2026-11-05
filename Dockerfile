# Build do PWA
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Backend + PWA estático
FROM python:3.12-slim
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/atmos ./atmos
COPY --from=web /app/web/dist /app/web/dist
ENV ATMOS_STATIC_DIR=/app/web/dist ATMOS_DB_PATH=/data/atmos.sqlite3
VOLUME /data
EXPOSE 8000
CMD ["uvicorn", "atmos.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
