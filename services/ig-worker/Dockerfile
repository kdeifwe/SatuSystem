FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
RUN useradd -r -u 10001 worker && chown -R worker /srv
USER worker

# Railway подставляет PORT сам; локально по умолчанию 8000
CMD ["sh", "-c", "uvicorn app.main:create_production_app --factory --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
