#!/usr/bin/env python3
"""Build XPI for batch-obsidian-export from src/ directory."""
import os, zipfile, sys

SRC = r"E:\OpenClaw\workspace\batch-obsidian-export\src"
OUT = r"E:\OpenClaw\workspace\batch-obsidian-export.xpi"
WORKSPACE = r"E:\OpenClaw\workspace\batch-obsidian-export"

EXCLUDE = {".gitkeep"}

# Also include defaults/preferences/prefs.js from project root
EXTRA_FILES = {
    "defaults/preferences/prefs.js": os.path.join(WORKSPACE, "src", "prefs.js"),
}

files_added = []

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
    # Walk src/ directory
    for root, dirs, files in os.walk(SRC):
        for f in sorted(files):
            if f in EXCLUDE:
                continue
            full = os.path.join(root, f)
            arcname = os.path.relpath(full, SRC).replace("\\", "/")
            zf.write(full, arcname)
            files_added.append(arcname)
    
    # Add extra files
    for arcname, source_path in EXTRA_FILES.items():
        if os.path.exists(source_path) and arcname not in files_added:
            zf.write(source_path, arcname)
            files_added.append(arcname)

# Verify
with zipfile.ZipFile(OUT, "r") as zf:
    bad = zf.testzip()
    if bad:
        print(f"ERROR: CRC mismatch on {bad}")
        sys.exit(1)

print(f"XPI created: {OUT}")
print(f"Size: {os.path.getsize(OUT)} bytes")
print(f"Files ({len(files_added)}):")
for f in files_added:
    info = zf.getinfo(f)
    print(f"  {f} ({info.file_size} bytes)")
