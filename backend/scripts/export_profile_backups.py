"""Download one versioned JSON backup for every Ritmo profile."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


def request_json(url: str, access_token: str) -> object:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "X-Ritmo-Key": access_token,
        },
    )
    with urlopen(request, timeout=30) as response:  # noqa: S310 - URL is operator supplied
        return json.load(response)


def write_json_atomic(path: Path, payload: object) -> str:
    encoded = (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_bytes(encoded)
    temporary.replace(path)
    return hashlib.sha256(encoded).hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export all Ritmo profiles without exposing the access key in arguments.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(".ritmo-backups"),
        help="Local ignored directory used for sensitive backup files.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    api_url = os.environ.get("RITMO_API_URL", "").strip().rstrip("/") + "/"
    access_token = os.environ.get("RITMO_ACCESS_TOKEN", "").strip()
    if api_url == "/" or not access_token:
        raise SystemExit("Set RITMO_API_URL and RITMO_ACCESS_TOKEN before exporting backups.")

    try:
        profiles = request_json(urljoin(api_url, "users"), access_token)
        if not isinstance(profiles, list) or not profiles:
            raise RuntimeError("The API returned no profiles.")

        stamp = datetime.now(UTC).strftime("%Y-%m-%dT%H-%M-%SZ")
        destination = args.output.resolve() / stamp
        destination.mkdir(parents=True, exist_ok=False)
        manifest_profiles: list[dict[str, object]] = []
        manifest: dict[str, object] = {
            "created_at": stamp,
            "api_url": api_url,
            "profiles": manifest_profiles,
        }

        for profile in profiles:
            if not isinstance(profile, dict):
                raise RuntimeError("The API returned an invalid profile entry.")
            user_id = profile.get("id")
            profile_id = str(profile.get("profile_id", user_id))
            if not isinstance(user_id, int):
                raise RuntimeError("The API returned a profile without a numeric id.")
            safe_profile_id = "".join(
                character if character.isalnum() or character in "-_" else "-"
                for character in profile_id
            ).strip("-") or str(user_id)
            payload = request_json(
                urljoin(api_url, f"users/{user_id}/backup"),
                access_token,
            )
            filename = f"ritmo-{safe_profile_id}-{stamp}.json"
            digest = write_json_atomic(destination / filename, payload)
            manifest_profiles.append(
                {
                    "user_id": user_id,
                    "profile_id": profile_id,
                    "file": filename,
                    "sha256": digest,
                }
            )

        write_json_atomic(destination / "manifest.json", manifest)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Backup export failed: {type(exc).__name__}") from exc

    print(f"Exported {len(profiles)} profile backups to {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
