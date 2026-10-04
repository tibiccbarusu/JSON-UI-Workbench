#!/usr/bin/env python3
"""Build a reproducible, asset-excluding public source release (Python 3.11+).

This copies an allowlist into a new directory. It never edits source inputs or
overwrites an existing release. No network, shell execution, or publishing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import struct
import zipfile
import zlib
from pathlib import Path

ROOT_FILES = {
    "README.md", "README-JA.md", "README-EN.md", "README-START-JA.md",
    "README-LOCAL-JA.md", "LICENSE.md", "LICENSE-JA.md", "LICENSE-EN.md",
    "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES-JA.md", "CHANGELOG.md",
    "CONTRIBUTING.md", "SECURITY.md", ".gitignore", ".gitattributes",
    "package.json", "package-lock.json", "start.bat", "start.cmd", "start.sh",
}
TREES = (
    "editor-core/app", "editor-core/src", "editor-core/tests", "editor-core/vendor",
    "editor-core/docs", "editor-core/scripts", "local-node", "docs/release",
    "scripts/release", ".github",
    "examples/revision12/pack", "examples/revision13/pack",
)
EXACT_EXCLUDES = {
    "local-node/runtime-files28.json",  # Rebuilt from this release's contents.
    "local-node/THIRD-PARTY-NOTICES.md",  # Superseded by root public notices.
    "local-node/tests/horse-v3-controller.json",
    "local-node/tests/horse.test.mjs",
    "local-node/tests/native-player-default.test.mjs",
    "local-node/tests/fixtures/settings-texture37.json",
    "local-node/tests/texture-value37.test.mjs",
    "editor-core/tests/fixtures/revision12-actions/official-action-excerpts.json",
    "editor-core/tests/ui-interaction-actions.node.test.mjs",
    "editor-core/tests/ui-audio-main12.node.test.mjs",
    "editor-core/app/fixtures/s018-small-fixture.zip",
    "editor-core/app/fixtures/s025-minimal-resource-pack.zip",
}
EXCLUDE_PREFIXES = ("local-node/vendor/canvas/",)
EXTENSIONS = {".js", ".mjs", ".cjs", ".json", ".html", ".css", ".md", ".txt",
              ".tsv", ".wasm", ".ps1", ".yml", ".yaml", ".py", ".lang",
              ".png", ".ogg"}
FIXTURE_ASSETS = {
    "local-node/tests/audio-fixtures/click.ogg",
}
FIXED_TIME = (2026, 9, 28, 0, 0, 0)


def stable_json(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def eligible(relative: str) -> bool:
    if relative in EXACT_EXCLUDES or relative.startswith(EXCLUDE_PREFIXES):
        return False
    parts = Path(relative).parts
    if any(p in {"node_modules", "__pycache__", ".git", "dist", "private-assets"} for p in parts):
        return False
    if relative in ROOT_FILES:
        return True
    if relative.startswith("scripts/") and len(parts) == 2:
        return parts[1] in {"verify-core.mjs", "verify-browser-static-graph.mjs", "verify-preview-state.mjs"} or parts[1].startswith("test-")
    if relative.startswith("examples/"):
        return relative in {"examples/revision12/build-pack.mjs", "examples/revision12/glyph-patterns.mjs"} or any(relative.startswith(tree + "/") for tree in TREES if tree.startswith("examples/"))
    suffix = Path(relative).suffix.lower()
    if suffix in {".png", ".ogg"}:
        return relative in FIXTURE_ASSETS or relative.startswith("docs/release/")
    return suffix in EXTENSIONS or Path(relative).name == "LICENSE"


def zip_bytes(entries: dict[str, bytes]) -> bytes:
    import io
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(name, FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    return output.getvalue()


def flat_png(red: int, green: int, blue: int) -> bytes:
    """An original 8×8 solid fixture; no game graphics involved."""
    def chunk(kind, value):
        return struct.pack(">I", len(value)) + kind + value + struct.pack(">I", zlib.crc32(kind + value))
    scanlines = b"".join(b"\0" + bytes([red, green, blue, 255]) * 8 for _ in range(8))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(scanlines)) + chunk(b"IEND", b"")


def demo_fixtures(output: Path):
    """Replace undocumented legacy fixture ZIPs with transparent original data."""
    screen = {"namespace": "sample", "sample_screen": {"type": "panel", "size": [240, 120],
        "controls": [{"background": {"type": "image", "texture": "textures/ui/test", "size": ["100%", "100%"]}},
                     {"caption": {"type": "label", "text": "JSON UI Workbench", "size": [220, 20], "offset": [0, -25]}}]}}
    common = {"ui/sample_screen.json": stable_json(screen).encode(),
              "texts/en_US.lang": b"sample.title=JSON UI Workbench\n",
              "CREDITS.md": b"Original JSON definitions and solid-color PNG created for JSON UI Workbench public tests. No Minecraft assets. Project rights notice applies.\n"}
    small = {**common, "hello.txt": b"JSON UI Workbench fixture\n"}
    manifest = {"format_version": 2, "header": {"name": "JSON UI Workbench Sample", "description": "Original public diagnostic fixture",
        "uuid": "392d51db-b231-41c9-b9c2-016a60b75a36", "version": [1, 0, 0], "min_engine_version": [1, 21, 0]},
        "modules": [{"type": "resources", "uuid": "982297f2-44b7-46b4-9b91-dfb8b73641c6", "version": [1, 0, 0]}]}
    full = {**common, "manifest.json": stable_json(manifest).encode(),
            "ui/_ui_defs.json": stable_json({"ui_defs": ["ui/sample_screen.json"]}).encode(),
            "ui/_global_variables.json": b"{}\n", "texts/languages.json": b'["en_US"]\n',
            "textures/ui/test.png": flat_png(43, 68, 78), "pack_icon.png": flat_png(48, 145, 155)}
    base = output / "editor-core/app/fixtures"
    base.mkdir(parents=True, exist_ok=True)
    (base / "s018-small-fixture.zip").write_bytes(zip_bytes(small))
    (base / "s025-minimal-resource-pack.zip").write_bytes(zip_bytes(full))


def build(source: Path, output_base: Path):
    package = json.loads((source / "package.json").read_text(encoding="utf-8"))
    version = package["version"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?", version):
        raise ValueError("Unsafe release version")
    output = output_base / f"jsonui-workbench-{version}"
    archive_path = output_base / f"jsonui-workbench-{version}-source.zip"
    if output.exists() or archive_path.exists():
        raise FileExistsError("Release output already exists; choose a new --output-dir")
    required = {"README.md", "LICENSE.md", "THIRD_PARTY_NOTICES.md", "package.json", "package-lock.json"}
    missing = [name for name in sorted(required) if not (source / name).is_file()]
    if missing:
        raise FileNotFoundError("Missing required publication files: " + ", ".join(missing))
    paths: set[Path] = set()
    for name in ROOT_FILES:
        path = source / name
        if path.is_file():
            paths.add(path)
    for name in TREES:
        base = source / name
        if base.exists():
            paths.update(path for path in base.rglob("*") if path.is_file())
    paths.update(path for path in (source / "scripts").glob("*.mjs") if path.is_file())
    paths.update(path for path in (source / "examples/revision12").glob("*.mjs") if path.is_file())
    output.mkdir(parents=True)
    copied = []
    for path in sorted(paths):
        relative = path.relative_to(source).as_posix()
        if not eligible(relative):
            continue
        if path.is_symlink() or source not in path.resolve().parents:
            raise ValueError("Refusing link/outside source: " + relative)
        if path.stat().st_size > 16 * 1024 * 1024:
            raise ValueError("Unexpected large public source file: " + relative)
        destination = output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
        copied.append(relative)
    demo_fixtures(output)
    # The inherited startup check must not require excluded licensed assets.
    runtime_files = sorted(p.relative_to(output).as_posix() for tree in ("editor-core", "local-node")
        for p in (output / tree).rglob("*") if p.is_file() and "/tests/" not in p.relative_to(output).as_posix())
    (output / "local-node/runtime-files28.json").write_text(stable_json({"schema": "jsonui-runtime-files-v1", "files": runtime_files}), encoding="utf-8")
    records = []
    entries = {}
    for path in sorted(output.rglob("*")):
        if path.is_file():
            relative = path.relative_to(output).as_posix()
            data = path.read_bytes()
            records.append({"path": relative, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
            entries[f"{output.name}/{relative}"] = data
    inventory = stable_json({"schema": "jsonui-workbench-public-distribution/v1", "version": version,
        "source_basis": "r41 / 0.13.6", "native_parity_verified": False,
        "project_license": package.get("license", "UNLICENSED"),
        "rights_status": "Project original portions: " + package.get("license", "UNLICENSED") + "; third-party and imported assets retain separate terms; see LICENSE.md", "excluded": sorted(EXACT_EXCLUDES),
        "excluded_trees": ["docs/r*", "docs/revision*", "editor-core/assets/native-default-player", "local-node/vendor/canvas"],
        "files": records}).encode()
    (output / "PUBLIC-DISTRIBUTION.json").write_bytes(inventory)
    entries[f"{output.name}/PUBLIC-DISTRIBUTION.json"] = inventory
    data = zip_bytes(entries)
    archive_path.write_bytes(data)
    checksum = hashlib.sha256(data).hexdigest()
    archive_path.with_suffix(archive_path.suffix + ".sha256").write_text(checksum + "  " + archive_path.name + "\n", encoding="ascii")
    print(stable_json({"directory": str(output), "archive": str(archive_path), "files": len(entries), "bytes": len(data), "sha256": checksum}), end="")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output-dir", type=Path)
    arguments = parser.parse_args()
    source_root = arguments.source.resolve()
    build(source_root, (arguments.output_dir or source_root / "dist").resolve())
