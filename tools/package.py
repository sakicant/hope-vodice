"""Build the upload bundle for the live PHP host.

    python tools/package.py

Writes dist/site/ and dist/hope-vodice-site.zip: the site built for the domain
root (no /hope-vodice/ prefix), the PHP handlers, and the .htaccess, in the
folder shape the server expects.

Left out on purpose: the build sources, the repository plumbing, the old-site
backup, the logo preview page, and api/config.php, which exists only on the
server and holds the delivery address.

The Vercel copy in hope-vodice/ is untouched; this is a second, separate build.
"""
import json, os, shutil, subprocess, sys, zipfile

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
SITE = os.path.join(DIST, "site")

site_json = json.load(open(os.path.join(ROOT, "src", "data", "site.json"), encoding="utf-8"))
SRC_SITE = os.path.join(ROOT, (site_json.get("base") or "").strip("/").replace("/", os.sep))

# Things that help while working but have no business on the live site.
SKIP = {"preview.html", "README.md"}

# Where the calendar panel lands in the bundle.
ADMIN_DIR = "manage"


def copy_assets() -> int:
    """Copy the asset tree first: the builder reads the image manifest from it."""
    n = 0
    src = os.path.join(SRC_SITE, "assets")
    for dirpath, _dirs, files in os.walk(src):
        rel = os.path.relpath(dirpath, src)
        dest = os.path.join(SITE, "assets", rel) if rel != "." else os.path.join(SITE, "assets")
        os.makedirs(dest, exist_ok=True)
        for f in files:
            if f in SKIP:
                continue
            shutil.copy2(os.path.join(dirpath, f), os.path.join(dest, f))
            n += 1
    return n


def main() -> None:
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(SITE)

    assets = copy_assets()

    # Build again with no base path, straight into dist/site.
    env = dict(os.environ, HOPE_BASE="", HOPE_OUT=os.path.relpath(SITE, ROOT))
    r = subprocess.run(["node", os.path.join("tools", "build.mjs")],
                       cwd=ROOT, env=env, capture_output=True, text=True, shell=(os.name == "nt"))
    if r.returncode != 0:
        sys.exit("build failed:\n" + (r.stderr or r.stdout))
    pages = sum(1 for line in r.stdout.splitlines() if line.strip().startswith("/"))

    # The PHP side.
    php_dir = os.path.join(SITE, "api")
    os.makedirs(php_dir, exist_ok=True)
    php = 0
    for f in ("contact.php", "calendar.php", "admin.php", "config.sample.php"):
        shutil.copy2(os.path.join(ROOT, "api", f), os.path.join(php_dir, f))
        php += 1

    shutil.copy2(os.path.join(ROOT, "server", ".htaccess"), os.path.join(SITE, ".htaccess"))

    # The calendar panel. Named plainly here; rename the folder on the server
    # if you would rather its address were not guessable. Everything inside
    # uses relative links, so a rename needs no other edit.
    admin_dest = os.path.join(SITE, ADMIN_DIR)
    shutil.copytree(os.path.join(ROOT, "admin"), admin_dest)
    admin = len(os.listdir(admin_dest))

    # Zip it, with the site at the archive root so it unpacks into public_html.
    archive = os.path.join(DIST, "hope-vodice-site.zip")
    total = 0
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for dirpath, _dirs, files in os.walk(SITE):
            for f in files:
                full = os.path.join(dirpath, f)
                z.write(full, os.path.relpath(full, SITE))
                total += 1

    size = os.path.getsize(archive) / 1048576
    print(f"pages:   {pages}")
    print(f"assets:  {assets}")
    print(f"php:     {php} files + .htaccess")
    print(f"panel:   {ADMIN_DIR}/ ({admin} files)")
    print(f"archive: dist/hope-vodice-site.zip  ({total} files, {size:.1f} MB)")
    print()
    print("On the server:")
    print("  1. unpack the archive into public_html")
    print("  2. copy api/config.sample.php to api/config.php and fill it in")
    print("  3. make sure api/ is writable, for the rate-limit file")
    print("  4. send yourself a test request from /contact/")
    print(f"  5. open /{ADMIN_DIR}/ and choose the calendar password")


if __name__ == "__main__":
    main()
