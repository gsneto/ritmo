"""Restore a directory created by export_profile_backups into an isolated API."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from hmac import compare_digest
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen


def request_json(
    url: str,
    access_token: str,
    *,
    payload: bytes | None = None,
    method: str = "GET",
) -> object:
    headers = {
        "Accept": "application/json",
        "X-Ritmo-Key": access_token,
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
    request = Request(url, data=payload, headers=headers, method=method)
    with urlopen(request, timeout=60) as response:  # noqa: S310 - URL is operator supplied
        return json.load(response)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Replace profiles in an isolated Ritmo API from exported JSON files.",
    )
    parser.add_argument("backup_directory", type=Path)
    parser.add_argument(
        "--confirm-profile-replacement",
        action="store_true",
        help="required because restore replaces the current profile content",
    )
    parser.add_argument(
        "--allow-remote",
        action="store_true",
        help="allow a non-loopback API; use only for an isolated staging environment",
    )
    return parser.parse_args()


def _confined_file(directory: Path, filename: str) -> Path:
    relative_path = Path(filename)
    if relative_path.is_absolute():
        raise RuntimeError("Backup manifest paths must be relative.")
    try:
        resolved = (directory / relative_path).resolve(strict=True)
        resolved.relative_to(directory)
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"Backup file {filename!r} is outside the backup directory.") from exc
    if not resolved.is_file():
        raise RuntimeError(f"Backup path {filename!r} is not a file.")
    return resolved


def load_validated_backups(directory: Path) -> list[tuple[str, bytes]]:
    """Load and validate the complete restore set before any profile is changed."""
    try:
        root = directory.resolve(strict=True)
    except OSError as exc:
        raise RuntimeError("The backup directory does not exist.") from exc
    if not root.is_dir():
        raise RuntimeError("The backup path is not a directory.")

    manifest_path = _confined_file(root, "manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise RuntimeError("The backup manifest must be a JSON object.")
    profile_entries = manifest.get("profiles")
    if not isinstance(profile_entries, list) or not profile_entries:
        raise RuntimeError("The backup manifest has no profiles.")

    validated: list[tuple[str, bytes]] = []
    seen_profiles: set[str] = set()
    seen_paths: set[Path] = set()
    for entry in profile_entries:
        if not isinstance(entry, dict):
            raise RuntimeError("The backup manifest has an invalid profile entry.")
        profile_id = entry.get("profile_id")
        filename = entry.get("file")
        expected_digest = entry.get("sha256")
        if not isinstance(profile_id, str) or not profile_id or profile_id in seen_profiles:
            raise RuntimeError("The backup manifest has a missing or duplicate profile id.")
        if not isinstance(filename, str) or not filename:
            raise RuntimeError(f"Profile {profile_id!r} has no backup file.")
        if not isinstance(expected_digest, str) or not re.fullmatch(
            r"[0-9a-fA-F]{64}",
            expected_digest,
        ):
            raise RuntimeError(f"Profile {profile_id!r} has an invalid SHA-256 digest.")

        backup_path = _confined_file(root, filename)
        if backup_path in seen_paths:
            raise RuntimeError("The backup manifest references the same file more than once.")
        payload = backup_path.read_bytes()
        actual_digest = hashlib.sha256(payload).hexdigest()
        if not compare_digest(actual_digest, expected_digest.lower()):
            raise RuntimeError(f"SHA-256 mismatch for profile {profile_id!r}.")
        parsed = json.loads(payload.decode("utf-8"))
        if not isinstance(parsed, dict):
            raise RuntimeError(f"Backup for profile {profile_id!r} must be a JSON object.")
        if parsed.get("app") != "Ritmo" or type(parsed.get("version")) is not int:
            raise RuntimeError(f"Backup for profile {profile_id!r} is not a Ritmo backup.")
        if parsed["version"] not in {1, 2}:
            raise RuntimeError(f"Backup for profile {profile_id!r} has an unsupported version.")

        seen_profiles.add(profile_id)
        seen_paths.add(backup_path)
        validated.append((profile_id, payload))
    return validated


def main() -> int:
    args = parse_args()
    if not args.confirm_profile_replacement:
        raise SystemExit("Pass --confirm-profile-replacement to continue.")

    api_url = os.environ.get("RITMO_API_URL", "").strip().rstrip("/") + "/"
    access_token = os.environ.get("RITMO_ACCESS_TOKEN", "").strip()
    if api_url == "/" or not access_token:
        raise SystemExit("Set RITMO_API_URL and RITMO_ACCESS_TOKEN before restoring.")
    hostname = urlsplit(api_url).hostname
    if hostname not in {"127.0.0.1", "localhost", "::1"} and not args.allow_remote:
        raise SystemExit("Remote restore requires --allow-remote and an isolated staging API.")

    try:
        backups = load_validated_backups(args.backup_directory)
        users = request_json(urljoin(api_url, "users"), access_token)
        if not isinstance(users, list):
            raise RuntimeError("The API returned an invalid user list.")
        user_ids = {
            str(user["profile_id"]): user["id"]
            for user in users
            if isinstance(user, dict) and "profile_id" in user and "id" in user
        }

        targets: list[tuple[int, bytes]] = []
        for profile_id, payload in backups:
            user_id = user_ids.get(profile_id)
            if not isinstance(user_id, int):
                raise RuntimeError(f"Profile {profile_id!r} is missing from the target API.")
            targets.append((user_id, payload))

        # A PUT is atomic for one profile only. Atomicity across profiles requires
        # restoring an isolated database and promoting that database as a unit.
        for user_id, payload in targets:
            request_json(
                urljoin(api_url, f"users/{user_id}/backup"),
                access_token,
                payload=payload,
                method="PUT",
            )
        restored = len(targets)
    except (
        HTTPError,
        OSError,
        RuntimeError,
        TimeoutError,
        UnicodeDecodeError,
        URLError,
        json.JSONDecodeError,
    ) as exc:
        raise SystemExit(f"Backup restore failed: {type(exc).__name__}") from exc

    print(f"Restored {restored} profiles into {api_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
