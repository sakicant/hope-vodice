"""Generate the responsive WebP variants the site ships.

    python tools/gen-images.py

Reads tools/sources.json, which maps a friendly name to an original under
scrape/media/. Writes assets/img/r/<name>-<width>.webp plus
assets/img/manifest.json, which the builder reads to emit srcset.

Originals stay out of the repository. Only the variants are committed, so the
site never serves a 2560 px photo to a phone.

Variants are never upscaled: a 320 px original gets one 320 px variant and the
manifest records how small it really is, so the builder can keep it out of
full-width slots.
"""
import json, os, sys

sys.stdout.reconfigure(encoding="utf-8")

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("Pillow is required:  pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_ROOT = os.path.join(ROOT, "scrape", "media")
OUT = os.path.join(ROOT, "assets", "img", "r")
WIDTHS = [480, 768, 1200, 1920]
QUALITY = 78

sources = json.load(open(os.path.join(ROOT, "tools", "sources.json"), encoding="utf-8"))
groups = {k: v for k, v in sources.items() if not k.startswith("_")}

os.makedirs(OUT, exist_ok=True)
manifest, made, skipped, missing = {}, 0, 0, []

for group, entries in groups.items():
    for name, rel in entries.items():
        src = os.path.join(SRC_ROOT, rel.replace("/", os.sep))
        if not os.path.exists(src):
            missing.append(f"{name} -> {rel}")
            continue

        im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
        w, h = im.size

        widths = [x for x in WIDTHS if x < w] + [w]          # never upscale
        widths = sorted(set(widths))

        for target in widths:
            dest = os.path.join(OUT, f"{name}-{target}.webp")
            if os.path.exists(dest):
                skipped += 1
                continue
            scaled = im if target == w else im.resize(
                (target, round(h * target / w)), Image.LANCZOS)
            scaled.save(dest, "WEBP", quality=QUALITY, method=6)
            made += 1

        manifest[name] = {
            "group": group,
            "w": w,
            "h": h,
            "variants": widths,
            "max": max(widths),
            "portrait": h > w,
            "lowres": w < 900,
        }

json.dump(dict(sorted(manifest.items())),
          open(os.path.join(ROOT, "assets", "img", "manifest.json"), "w", encoding="utf-8"),
          indent=1)

print(f"variants written: {made}   already there: {skipped}")
print(f"images in manifest: {len(manifest)}")

low = [n for n, e in manifest.items() if e["lowres"]]
if low:
    print(f"\nlow resolution ({len(low)}) - under 900 px wide, only safe in small slots:")
    for n in sorted(low):
        e = manifest[n]
        print(f"  {e['w']:>5}x{e['h']:<5}  {n}")

if missing:
    print(f"\nmissing originals ({len(missing)}):")
    for m in missing:
        print("  " + m)
