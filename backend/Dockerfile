FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN addgroup --system ritmo \
    && adduser --system --ingroup ritmo ritmo \
    && chown ritmo:ritmo /app

COPY --chown=ritmo:ritmo . .

USER ritmo

EXPOSE 8000

# Migrations are NOT run on boot. Applying schema changes is an explicit,
# auditable operator step (`alembic upgrade head`) so a restart or a sleeping
# instance can never change the database by itself.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
