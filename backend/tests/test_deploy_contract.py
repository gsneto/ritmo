"""Guards for the staging deployment contract.

These are static checks on files that a runtime test cannot cover without a
container engine. They encode decisions that are easy to regress silently.
"""

from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND.parent


def test_dockerfile_does_not_run_migrations_on_boot():
    dockerfile = (BACKEND / "Dockerfile").read_text(encoding="utf-8")
    cmd_line = next(
        line for line in dockerfile.splitlines() if line.startswith("CMD ")
    )

    # Schema changes must be an explicit operator step, never a side effect of
    # a restart or a wake-up from sleep.
    assert "alembic" not in cmd_line.lower()
    assert "uvicorn" in cmd_line


def test_dockerfile_binds_all_interfaces_and_honours_port():
    dockerfile = (BACKEND / "Dockerfile").read_text(encoding="utf-8")

    assert "0.0.0.0" in dockerfile
    assert "${PORT:-8000}" in dockerfile


def test_dockerignore_excludes_secrets_and_local_databases():
    patterns = {
        line.strip()
        for line in (BACKEND / ".dockerignore").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    }

    required = {
        ".env",
        ".venv/",
        "*.db",
        "*.sqlite",
        "*.dump",
        "*.age",
        "*.pem",
        "*.key",
        "*.log",
        "tests/",
        ".coverage",
    }
    missing = sorted(required - patterns)
    assert not missing, f"dockerignore is missing: {missing}"


def test_render_blueprint_is_free_and_stateless():
    blueprint = (REPO_ROOT / "render.yaml").read_text(encoding="utf-8")

    assert "plan: free" in blueprint
    assert "region: virginia" in blueprint
    assert "dockerfilePath: ./backend/Dockerfile" in blueprint
    assert "dockerContext: ./backend" in blueprint
    assert "healthCheckPath: /ready" in blueprint
    # A persistent disk is a paid feature and would defeat the ephemeral design.
    assert "disk:" not in blueprint
    # Secrets must be prompted, never committed.
    assert "sync: false" in blueprint


def test_render_blueprint_does_not_contain_connection_strings():
    blueprint = (REPO_ROOT / "render.yaml").read_text(encoding="utf-8")

    assert "postgres://" not in blueprint
    assert "postgresql://" not in blueprint
    assert "neon.tech" not in blueprint


def test_vercel_rewrites_api_before_the_spa_catch_all():
    import json

    config = json.loads((REPO_ROOT / "vercel.json").read_text(encoding="utf-8"))
    sources = [rule["source"] for rule in config["rewrites"]]

    assert sources.index("/api/:path*") < sources.index("/(.*)")

    api_rule = next(
        rule for rule in config["rewrites"] if rule["source"] == "/api/:path*"
    )
    # FastAPI routes already start with /api, so the prefix must be preserved
    # on both sides. Dropping it would produce 404s, duplicating it would
    # produce /api/api/...
    assert api_rule["destination"].endswith("/api/:path*")
    assert api_rule["destination"].count("/api/") == 1


def test_vercel_marks_api_responses_as_no_store():
    import json

    config = json.loads((REPO_ROOT / "vercel.json").read_text(encoding="utf-8"))
    api_headers = next(
        entry for entry in config["headers"] if entry["source"] == "/api/(.*)"
    )
    keys = {header["key"]: header["value"] for header in api_headers["headers"]}

    assert "no-store" in keys["Cache-Control"]


def test_vercel_config_contains_no_secrets():
    text = (REPO_ROOT / "vercel.json").read_text(encoding="utf-8")

    for needle in ("npg_", "postgres://", "postgresql://", "APP_ACCESS_TOKEN", "neon.tech"):
        assert needle not in text
