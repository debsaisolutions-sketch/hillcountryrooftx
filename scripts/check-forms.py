#!/usr/bin/env python3
"""Fail if lead forms regress to a placeholder endpoint, a fake phone, or a missing local asset.

Patterns are assembled in this file so the checker does not contain the
forbidden strings it scans for.
"""

from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

NEEDLES = (
    "form" + "spree",
    "YOUR_" + "FORM_ID",
    "REPLACE_" + "WITH",
)
PHONE_RE = re.compile("555" + r"-\d")
ASSET_EXT = (
    ".js",
    ".mjs",
    ".css",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".avif",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".mp4",
    ".webm",
    ".pdf",
)
TEXT_EXT = {
    ".html",
    ".htm",
    ".js",
    ".mjs",
    ".css",
    ".md",
    ".json",
    ".yml",
    ".yaml",
    ".txt",
    ".xml",
    ".svg",
}
SKIP_DIRS = {".git", "node_modules"}
ATTR_RE = re.compile(r"""\b(?:src|href)\s*=\s*(['"])(.*?)\1""", re.I)
PROFILE_ID = "63e7470e-fe1e-4367-aae0-56d0d6392d78"
API_URL = "https://www.tradedeskpro.com/api/leads"
SECRET_HEADER = "X-TDP-" + "Lead-Secret"


def rel(path: str) -> str:
    return os.path.relpath(path, ROOT)


def iter_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            path = os.path.join(dirpath, name)
            ext = os.path.splitext(name)[1].lower()
            if ext in TEXT_EXT:
                yield path


def is_local_asset(url: str) -> bool:
    target = url.split("#", 1)[0].split("?", 1)[0].strip()
    if not target or target.startswith("#"):
        return False
    if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I):
        return False
    if target.startswith("//"):
        return False
    path = target.split("/")[-1].lower()
    return path.endswith(ASSET_EXT)


def resolve_asset(html_path: str, url: str) -> str | None:
    target = url.split("#", 1)[0].split("?", 1)[0].strip()
    if target.startswith("/"):
        candidate = target.lstrip("/")
    else:
        candidate = os.path.normpath(os.path.join(os.path.dirname(rel(html_path)), target))
    if candidate.startswith("..") or os.path.isabs(candidate):
        return None
    return candidate


def check() -> list[str]:
    problems: list[str] = []
    for path in iter_files():
        ext = os.path.splitext(path)[1].lower()
        try:
            text = open(path, encoding="utf-8", errors="replace").read()
        except OSError as exc:
            problems.append(f"{rel(path)}: unreadable ({exc})")
            continue

        lower = text.lower()
        for needle in NEEDLES:
            start = 0
            hay = lower if needle == NEEDLES[0] else text
            probe = needle.lower() if needle == NEEDLES[0] else needle
            while True:
                idx = hay.find(probe, start)
                if idx == -1:
                    break
                line = text.count("\n", 0, idx) + 1
                problems.append(f"{rel(path)}:{line}: forbidden placeholder {needle}")
                start = idx + len(probe)

        for match in PHONE_RE.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            problems.append(f"{rel(path)}:{line}: placeholder phone number")

        if ext in {".html", ".htm"}:
            if re.search(r"<form\b", text, re.I) and "js/tdp-leads.js" not in text:
                problems.append(f"{rel(path)}: form is missing /js/tdp-leads.js")
            for attr in ATTR_RE.finditer(text):
                url = attr.group(2)
                if not is_local_asset(url):
                    continue
                candidate = resolve_asset(path, url)
                if candidate is None:
                    line = text.count("\n", 0, attr.start()) + 1
                    problems.append(f"{rel(path)}:{line}: local asset escapes the site root ({url})")
                    continue
                full = os.path.join(ROOT, candidate)
                if not os.path.isfile(full):
                    line = text.count("\n", 0, attr.start()) + 1
                    problems.append(f"{rel(path)}:{line}: missing local asset {candidate}")

    leads_path = os.path.join(ROOT, "js", "tdp-leads.js")
    if not os.path.isfile(leads_path):
        problems.append("js/tdp-leads.js: missing lead script")
    else:
        leads = open(leads_path, encoding="utf-8").read()
        if PROFILE_ID not in leads:
            problems.append("js/tdp-leads.js: profile id is missing")
        if API_URL not in leads:
            problems.append("js/tdp-leads.js: lead endpoint is missing")
        if SECRET_HEADER in leads:
            problems.append("js/tdp-leads.js: lead secret must not ship in browser code")

    return problems


def main() -> int:
    problems = check()
    if problems:
        print("Lead form check failed:", file=sys.stderr)
        for item in problems:
            print(f"  {item}", file=sys.stderr)
        return 1
    print("Lead form check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
