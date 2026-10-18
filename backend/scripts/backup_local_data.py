"""Create and verify an encrypted, self-describing backup of the local data.

The passphrase is read from ``RITMO_BACKUP_PASSPHRASE`` so it never appears in
the process arguments or in shell history. Set it for a single command:

    $env:RITMO_BACKUP_PASSPHRASE = '<passphrase>'
    python -m scripts.backup_local_data create --output-dir <dir> `
        --sqlite backend/ritmo.db --json-dir .ritmo-backups
    Remove-Item Env:RITMO_BACKUP_PASSPHRASE

Format: ``RITMOBK1`` + scrypt salt + AES-256-GCM nonce + ciphertext, where the
plaintext is a gzip-compressed tar of the selected files. Authenticated
encryption means a corrupted or tampered file fails loudly instead of yielding
garbage.

Nothing is written unencrypted to disk: the tar and gzip streams live in memory
only. ``verify`` decrypts into a private temporary directory, compares every
SHA-256, runs ``PRAGMA integrity_check`` on restored SQLite files, and removes
the temporary directory afterwards.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import sqlite3
import sys
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

MAGIC = b"RITMOBK1"
SALT_BYTES = 16
NONCE_BYTES = 12
KDF_N = 2**15
KDF_R = 8
KDF_P = 1
FORMAT_VERSION = 1
PASSPHRASE_ENV = "RITMO_BACKUP_PASSPHRASE"
MIN_PASSPHRASE_LENGTH = 16


class BackupError(RuntimeError):
    """Raised when a backup cannot be created or verified safely."""


def _passphrase() -> bytes:
    value = os.environ.get(PASSPHRASE_ENV, "")
    if not value:
        raise BackupError(
            f"{PASSPHRASE_ENV} is not set. Export it for this command only; "
            "never write it to a script or commit it."
        )
    if len(value) < MIN_PASSPHRASE_LENGTH:
        raise BackupError(
            f"{PASSPHRASE_ENV} must have at least {MIN_PASSPHRASE_LENGTH} characters."
        )
    return value.encode("utf-8")


def _derive_key(passphrase: bytes, salt: bytes) -> bytes:
    kdf = Scrypt(salt=salt, length=32, n=KDF_N, r=KDF_R, p=KDF_P)
    return kdf.derive(passphrase)


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _collect(sqlite_paths: list[Path], json_dirs: list[Path]) -> list[Path]:
    files: list[Path] = []
    for path in sqlite_paths:
        if not path.is_file():
            raise BackupError(f"SQLite file not found: {path}")
        files.append(path)
    for directory in json_dirs:
        if not directory.is_dir():
            raise BackupError(f"JSON directory not found: {directory}")
        for path in sorted(directory.rglob("*.json")):
            if path.is_file():
                files.append(path)
    if not files:
        raise BackupError("Nothing to back up: no files matched.")
    return files


def _archive_entries(files: list[Path], base: Path) -> tuple[bytes, list[dict]]:
    buffer = io.BytesIO()
    entries: list[dict] = []
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for path in files:
            try:
                arcname = path.resolve().relative_to(base.resolve()).as_posix()
            except ValueError:
                arcname = path.name
            payload = path.read_bytes()
            info = tarfile.TarInfo(name=arcname)
            info.size = len(payload)
            info.mtime = int(path.stat().st_mtime)
            tar.addfile(info, io.BytesIO(payload))
            entries.append(
                {
                    "path": arcname,
                    "bytes": len(payload),
                    "sha256": _sha256_bytes(payload),
                }
            )
    return buffer.getvalue(), entries


def create(output_dir: Path, sqlite_paths: list[Path], json_dirs: list[Path]) -> int:
    passphrase = _passphrase()
    files = _collect(sqlite_paths, json_dirs)

    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    stem = f"ritmo-backup-{stamp}"
    archive_path = output_dir / f"{stem}.tar.gz.enc"
    manifest_path = output_dir / f"{stem}.manifest.json"

    for candidate in (archive_path, manifest_path):
        if candidate.exists():
            raise BackupError(f"Refusing to overwrite an existing backup: {candidate}")

    base = Path.cwd()
    plaintext, entries = _archive_entries(files, base)

    salt = os.urandom(SALT_BYTES)
    nonce = os.urandom(NONCE_BYTES)
    key = _derive_key(passphrase, salt)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, MAGIC)

    output_dir.mkdir(parents=True, exist_ok=True)
    blob = MAGIC + salt + nonce + ciphertext
    archive_path.write_bytes(blob)

    manifest = {
        "format": FORMAT_VERSION,
        "created_at": datetime.now(UTC).isoformat(),
        "cipher": "AES-256-GCM",
        "kdf": {"name": "scrypt", "n": KDF_N, "r": KDF_R, "p": KDF_P, "salt_bytes": SALT_BYTES},
        "archive": {
            "name": archive_path.name,
            "bytes": len(blob),
            "sha256": _sha256_bytes(blob),
        },
        "files": entries,
    }
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    print(f"archive: {archive_path}")
    print(f"manifest: {manifest_path}")
    print(f"files: {len(entries)}")
    print(f"plaintext_bytes: {len(plaintext)}")
    print(f"archive_sha256: {manifest['archive']['sha256']}")
    print("Create a second copy of the manifest elsewhere: it is not encrypted.")
    return 0


def _read_manifest(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("format") != FORMAT_VERSION:
        raise BackupError(f"Unsupported backup format: {data.get('format')!r}")
    return data


def verify(archive_path: Path, manifest_path: Path, *, keep: bool) -> int:
    passphrase = _passphrase()
    manifest = _read_manifest(manifest_path)

    blob = archive_path.read_bytes()
    if _sha256_bytes(blob) != manifest["archive"]["sha256"]:
        raise BackupError("The archive SHA-256 does not match the manifest.")

    if not blob.startswith(MAGIC):
        raise BackupError("The archive is not a Ritmo backup file.")

    offset = len(MAGIC)
    salt = blob[offset : offset + SALT_BYTES]
    offset += SALT_BYTES
    nonce = blob[offset : offset + NONCE_BYTES]
    offset += NONCE_BYTES
    ciphertext = blob[offset:]

    key = _derive_key(passphrase, salt)
    plaintext = AESGCM(key).decrypt(nonce, ciphertext, MAGIC)

    expected = {entry["path"]: entry for entry in manifest["files"]}
    workdir = Path(tempfile.mkdtemp(prefix="ritmo-verify-"))
    problems: list[str] = []
    checked = 0
    sqlite_checks = 0
    try:
        with tarfile.open(fileobj=io.BytesIO(plaintext), mode="r:gz") as tar:
            for member in tar.getmembers():
                if not member.isfile():
                    continue
                name = member.name
                payload = tar.extractfile(member)
                if payload is None:
                    problems.append(f"{name}: could not be read from the archive")
                    continue
                data = payload.read()
                digest = _sha256_bytes(data)
                record = expected.get(name)
                if record is None:
                    problems.append(f"{name}: not listed in the manifest")
                    continue
                if record["sha256"] != digest:
                    problems.append(f"{name}: SHA-256 mismatch")
                    continue
                if record["bytes"] != len(data):
                    problems.append(f"{name}: size mismatch")
                    continue
                checked += 1
                target = workdir / Path(name).name
                target.write_bytes(data)
                if target.suffix == ".db":
                    conn = sqlite3.connect(f"file:{target.as_posix()}?mode=ro", uri=True)
                    try:
                        result = conn.execute("PRAGMA integrity_check").fetchone()[0]
                    finally:
                        conn.close()
                    if result != "ok":
                        problems.append(f"{name}: integrity_check returned {result!r}")
                    else:
                        sqlite_checks += 1

        if checked != len(expected):
            problems.append(
                f"expected {len(expected)} files, verified {checked}"
            )
    finally:
        if keep:
            print(f"kept decrypted copy for inspection: {workdir}")
        else:
            shutil.rmtree(workdir, ignore_errors=True)

    print(f"files_verified: {checked}")
    print(f"sqlite_integrity_ok: {sqlite_checks}")
    if problems:
        print("VERIFY FAILED:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("VERIFY OK")
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    create_parser = sub.add_parser("create", help="create an encrypted backup")
    create_parser.add_argument("--output-dir", type=Path, required=True)
    create_parser.add_argument(
        "--sqlite",
        type=Path,
        action="append",
        default=[],
        help="SQLite database to include (repeatable)",
    )
    create_parser.add_argument(
        "--json-dir",
        type=Path,
        action="append",
        default=[],
        help="directory with backup JSON files (repeatable)",
    )

    verify_parser = sub.add_parser("verify", help="decrypt and verify a backup")
    verify_parser.add_argument("archive", type=Path)
    verify_parser.add_argument("manifest", type=Path)
    verify_parser.add_argument(
        "--keep",
        action="store_true",
        help="keep the decrypted files (only for a private temporary directory)",
    )

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        if args.command == "create":
            return create(args.output_dir, args.sqlite, args.json_dir)
        return verify(args.archive, args.manifest, keep=args.keep)
    except BackupError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
