import hashlib
import json
from types import SimpleNamespace

import pytest

from scripts import restore_profile_backups


def _write_backup(path, *, app="Ritmo", version=2) -> str:
    payload = json.dumps({"app": app, "version": version}).encode()
    path.write_bytes(payload)
    return hashlib.sha256(payload).hexdigest()


def test_restore_validates_every_checksum_and_json_before_api_calls(
    tmp_path,
    monkeypatch,
):
    first_digest = _write_backup(tmp_path / "first.json")
    second_digest = _write_backup(tmp_path / "second.json", app="Other")
    (tmp_path / "manifest.json").write_text(
        json.dumps(
            {
                "profiles": [
                    {
                        "profile_id": "first",
                        "file": "first.json",
                        "sha256": first_digest,
                    },
                    {
                        "profile_id": "second",
                        "file": "second.json",
                        "sha256": second_digest,
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    calls = []
    monkeypatch.setattr(
        restore_profile_backups,
        "parse_args",
        lambda: SimpleNamespace(
            backup_directory=tmp_path,
            confirm_profile_replacement=True,
            allow_remote=False,
        ),
    )
    monkeypatch.setattr(
        restore_profile_backups,
        "request_json",
        lambda *args, **kwargs: calls.append((args, kwargs)),
    )
    monkeypatch.setenv("RITMO_API_URL", "http://localhost:8000/api")
    monkeypatch.setenv("RITMO_ACCESS_TOKEN", "test-token")

    with pytest.raises(SystemExit, match="Backup restore failed: RuntimeError"):
        restore_profile_backups.main()

    assert calls == []


def test_restore_rejects_manifest_path_escape_and_digest_mismatch(tmp_path):
    outside = tmp_path.parent / f"{tmp_path.name}-outside.json"
    outside.write_text('{"app":"Ritmo","version":2}', encoding="utf-8")
    try:
        digest = hashlib.sha256(outside.read_bytes()).hexdigest()
        (tmp_path / "manifest.json").write_text(
            json.dumps(
                {
                    "profiles": [
                        {
                            "profile_id": "outside",
                            "file": "../outside-restore-test.json",
                            "sha256": digest,
                        }
                    ]
                }
            ),
            encoding="utf-8",
        )
        with pytest.raises(RuntimeError, match="outside the backup directory"):
            restore_profile_backups.load_validated_backups(tmp_path)

        local_digest = _write_backup(tmp_path / "local.json")
        (tmp_path / "manifest.json").write_text(
            json.dumps(
                {
                    "profiles": [
                        {
                            "profile_id": "local",
                            "file": "local.json",
                            "sha256": "0" * 64,
                        }
                    ]
                }
            ),
            encoding="utf-8",
        )
        assert local_digest != "0" * 64
        with pytest.raises(RuntimeError, match="SHA-256 mismatch"):
            restore_profile_backups.load_validated_backups(tmp_path)
    finally:
        outside.unlink(missing_ok=True)


def test_restore_resolves_all_target_profiles_before_first_put(tmp_path, monkeypatch):
    entries = []
    for profile_id in ("present", "missing"):
        filename = f"{profile_id}.json"
        entries.append(
            {
                "profile_id": profile_id,
                "file": filename,
                "sha256": _write_backup(tmp_path / filename),
            }
        )
    (tmp_path / "manifest.json").write_text(
        json.dumps({"profiles": entries}),
        encoding="utf-8",
    )
    methods = []

    def fake_request(_url, _token, *, payload=None, method="GET"):
        methods.append(method)
        assert payload is None
        return [{"id": 1, "profile_id": "present"}]

    monkeypatch.setattr(
        restore_profile_backups,
        "parse_args",
        lambda: SimpleNamespace(
            backup_directory=tmp_path,
            confirm_profile_replacement=True,
            allow_remote=False,
        ),
    )
    monkeypatch.setattr(restore_profile_backups, "request_json", fake_request)
    monkeypatch.setenv("RITMO_API_URL", "http://localhost:8000/api")
    monkeypatch.setenv("RITMO_ACCESS_TOKEN", "test-token")

    with pytest.raises(SystemExit, match="Backup restore failed: RuntimeError"):
        restore_profile_backups.main()

    assert methods == ["GET"]
