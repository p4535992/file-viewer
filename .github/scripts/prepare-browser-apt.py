#!/usr/bin/env python3
"""Bound Ubuntu downloads on an ephemeral GitHub-hosted browser runner."""

import argparse
from pathlib import Path
import re


ARCHIVE = "https://archive.ubuntu.com/ubuntu/"
SECURITY = "https://security.ubuntu.com/ubuntu/"
AZURE = "http://azure.archive.ubuntu.com/ubuntu/"
OPTIONS = '''// Browser CI: retain APT's signed metadata and package hash verification.
Acquire::Retries "2";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
'''


def prepare(mirrors, config):
    # These HTTPS alternatives are already in the official runner mirror list:
    # https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt-sources.sh
    # A slow but responsive Azure download does not trigger APT's idle timeout.
    # Only change that known mirror list, never sources, suites or signing keys.
    for target in (mirrors, config):
        if target.is_symlink():
            raise ValueError("APT preparation refuses symbolic links")
        if target.exists() and not target.is_file():
            raise ValueError("APT preparation requires regular configuration files")
        if not target.parent.is_dir():
            raise ValueError("APT preparation requires existing parent directories")
    entries = []
    for line in mirrors.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"(\S+)\s+priority:\d+", line)
        if not match or match[1] not in (AZURE, ARCHIVE, SECURITY):
            raise ValueError("Unrecognized runner mirror configuration; no files changed")
        entries.append(match[1])
    if len(set(entries)) != len(entries) or not {ARCHIVE, SECURITY}.issubset(entries):
        raise ValueError("Expected unique official HTTPS archive alternatives; no files changed")
    mirrors.write_text(f"{ARCHIVE}\tpriority:1\n{SECURITY}\tpriority:2\n")
    config.write_text(OPTIONS)
    print("Ubuntu browser downloads: official HTTPS archives, two retries, 30s idle timeout")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mirror-list", type=Path, default=Path("/etc/apt/apt-mirrors.txt"))
    parser.add_argument(
        "--apt-config", type=Path,
        default=Path("/etc/apt/apt.conf.d/80-file-viewer-browser"),
    )
    args = parser.parse_args()
    try:
        prepare(args.mirror_list, args.apt_config)
    except (OSError, ValueError) as error:
        parser.exit(1, f"APT preparation failed: {error}\n")


if __name__ == "__main__":
    main()
