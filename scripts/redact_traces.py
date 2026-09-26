#!/usr/bin/env python3
"""Redact every Playwright trace under the given folders, in place, then verify.

Traces record request headers, cookies and response bodies: Clerk session JWTs,
dev-browser tokens and testing tokens would otherwise be published with a CI
artifact. This runs before any upload. Exit code 1 if anything survives, so the
upload step never runs on an unredacted file.
"""
import json, re, sys, zipfile
from pathlib import Path

PATTERNS = [
    (re.compile(rb"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"), b"[redacted-jwt]"),
    (re.compile(rb"\b(sk|pk)_(test|live)_[A-Za-z0-9]+"), b"[redacted-key]"),
    (re.compile(rb"dvb_[A-Za-z0-9]+"), b"[redacted-dev-browser]"),
    (re.compile(rb"(__clerk_testing_token=)[^&\"'\s;]+"), rb"\1[redacted]"),
    (re.compile(rb"(__clerk_db_jwt[A-Za-z0-9_]*=)[^&\"'\s;]+"), rb"\1[redacted]"),
    (re.compile(rb"(__session[A-Za-z0-9_]*=)[^&\"'\s;]+"), rb"\1[redacted]"),
    (re.compile(rb"(__client[A-Za-z0-9_]*=)[^&\"'\s;]+"), rb"\1[redacted]"),
]
LEAK = re.compile(rb"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.|dvb_[A-Za-z0-9]{8,}|__clerk_testing_token=[^\[]|(sk|pk)_(test|live)_[A-Za-z0-9]{8,}")
SENSITIVE_HEADERS = {"cookie", "set-cookie", "authorization", "x-clerk-auth-token"}
IMAGES = (".png", ".jpeg", ".jpg", ".webp", ".webm")


def scrub_json(obj):
    if isinstance(obj, dict):
        name = obj.get("name")
        if isinstance(name, str) and name.lower() in SENSITIVE_HEADERS and "value" in obj:
            obj["value"] = "[redacted]"
        for key, value in obj.items():
            if key == "cookies" and isinstance(value, list):
                for cookie in value:
                    if isinstance(cookie, dict) and "value" in cookie:
                        cookie["value"] = "[redacted]"
            else:
                scrub_json(value)
    elif isinstance(obj, list):
        for value in obj:
            scrub_json(value)


def scrub_bytes(data: bytes) -> bytes:
    for pattern, repl in PATTERNS:
        data = pattern.sub(repl, data)
    return data


def scrub_member(name: str, data: bytes) -> bytes:
    if name.lower().endswith(IMAGES):
        return data
    if name.endswith((".trace", ".network")):
        lines = []
        for line in data.splitlines():
            try:
                event = json.loads(line)
                scrub_json(event)
                line = json.dumps(event, separators=(",", ":")).encode()
            except ValueError:
                pass
            lines.append(scrub_bytes(line))
        return b"\n".join(lines)
    return scrub_bytes(data)


def redact_zip(path: Path) -> int:
    with zipfile.ZipFile(path) as zin:
        members = [(info, scrub_member(info.filename, zin.read(info.filename))) for info in zin.infolist()]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zout:
        for info, data in members:
            zout.writestr(info, data)
    leaks = 0
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if not name.lower().endswith(IMAGES) and LEAK.search(z.read(name)):
                print(f"LEAK remains in {path}:{name}")
                leaks += 1
    return leaks


def main(folders):
    zips, leaks = 0, 0
    for folder in folders:
        root = Path(folder)
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.suffix == ".zip":
                zips += 1
                leaks += redact_zip(path)
            elif path.is_file() and not path.name.lower().endswith(IMAGES):
                data = path.read_bytes()
                clean = scrub_bytes(data)
                if clean != data:
                    path.write_bytes(clean)
                if LEAK.search(clean):
                    print(f"LEAK remains in {path}")
                    leaks += 1
    print(f"redacted {zips} trace archives; leaks remaining: {leaks}")
    return 1 if leaks else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
