# hope-vodice.com

Website for **Hope Apartments** — three apartments in one family house in Vodice, Croatia, rented by Nada and Bernard Mikulić. Rebuilt from scratch to replace the old WordPress site.

Plain HTML, CSS and about 9 KB of JavaScript. No framework, no database, no build dependencies — `node tools/build.mjs` and nothing else.

## Status

Working draft. **Bernard has confirmed neither the logo nor the content**, and the nightly rates are not in yet.

## What makes this different from a one-property site

Each apartment owns **its own calendar and its own price list**. `assets/data/calendar-h1.json`, `-h2` and `-h3` share nothing: H1 being booked says nothing about H2, and the three can be priced independently. A page declares `"apartment": "h2"` in its meta block and the builder binds that file to the calendar, the rate table and the booking form.

## Layout

```
src/
  layout.html          page shell: head, header, footer
  pages/*.html         one file per page, with a <!--meta {...} --> block on top
  data/site.json       contacts, nav, the three apartments, FAQ, base path
  data/icons.json      inline SVG icon paths
tools/
  build.mjs            the builder
  gen-images.py        makes the WebP variants
  sources.json         which original photo belongs to which apartment
hope-vodice/           THE BUILT SITE — generated, do not hand-edit the HTML
  assets/css/main.css  the whole design system
  assets/js/           calendar-core.js (pricing rules) + main.js (behaviour)
  assets/data/         one calendar file per apartment
  assets/logo/         the logo, hand-made, not generated
  assets/img/r/        responsive variants, generated
scrape/                backup of the old site (git-ignored, local only)
```

Everything inside `hope-vodice/` except `assets/css`, `assets/js`, `assets/data` and `assets/logo` is generated. Edit `src/`, then rebuild.

## Working on it

```bash
node tools/build.mjs
```

```bash
python -m http.server 5700
```

Then open `http://127.0.0.1:5700/hope-vodice/` — the same path it has on Vercel, so local and deployed behave identically.

After adding photos to `tools/sources.json`:

```bash
python tools/gen-images.py
```

## The base path

`src/data/site.json` has a `base` field, currently `"/hope-vodice"`. It does two things at once: the site builds into a folder of that name, and every internal link and asset URL gets that prefix. No rewrite rules anywhere.

To move the site to the domain root:

1. set `"base": ""` in `src/data/site.json`
2. move `hope-vodice/assets/` up to the repo root
3. `node tools/build.mjs`

`robots.txt` follows the same switch: with a base path set it asks search engines to stay away, because a review copy on a preview domain should not compete with the real site. With `base` empty it allows crawling and points at the sitemap.

## Deployment

There are two targets, and they are built separately.

### Vercel — the review copy

Vercel serves the repository root as a static site, so the site answers at `/hope-vodice/`. `vercel.json` redirects `/` there, caches the image variants for a year, keeps the calendar files uncached, and sets `X-Robots-Tag: noindex` across the whole preview. `.vercelignore` keeps `src/`, `tools/`, `api/` and the old-site backup out of the deploy.

There is no PHP on Vercel, so the booking form cannot post. It falls back to handing the visitor a pre-filled email instead of failing silently.

### The live host — Apache or LiteSpeed with PHP

```bash
python tools/package.py
```

Writes `dist/hope-vodice-site.zip`: the site built for the domain root with no path prefix, the PHP handlers, and `.htaccess`, in the shape the server expects. It leaves out the build sources, the backup, the logo preview page and `api/config.php`.

On the server:

1. unpack the archive into `public_html`
2. copy `api/config.sample.php` to `api/config.php` and fill it in
3. make sure `api/` is writable — the rate limiter keeps a small file there
4. send yourself a test request from `/contact/`

**The `from` address in `config.php` must be on hope-vodice.com.** Putting the guest's address there is the usual mistake and SPF will send the mail to spam. The guest's address goes in `Reply-To`, so hitting reply in the mailbox answers them.

### What the PHP does

`api/contact.php` validates the request, drops anything that fills the honeypot, and **re-prices the stay from the calendar file on the server**. The apartment and the dates arrive as form values and form values can be edited, so whatever total the browser showed, the one in the email is the one the server worked out.

`api/calendar.php` is that pricing logic — a mirror of `assets/js/calendar-core.js`. Both read the same `calendar-<id>.json`. **Change a rule in one and change it in the other.**

It runs on PHP 7.4 and up, with or without `mbstring`.

### The calendar panel

`admin/` is a small panel for setting availability and prices without touching JSON. It ships in the bundle as `manage/` and needs PHP, so it does not exist on Vercel.

Open `/manage/`. The first time, it asks you to choose a password and writes the hash to `api/admin-hash.php`; once that file exists the setup screen never appears again, so it cannot be used to reset the password from outside. To change it later, delete that file on the server and open the panel again.

Pick an apartment, click a date and then another to take the stretch between them, set free/booked, a nightly price and a minimum stay, and press Save. "Reset to season default" clears a date's own settings so a later season change reaches it again. **Nothing is written until Save.** Season rates are edited in the same screen.

The panel reads the same `calendar-core.js` rules as the public site, so what it previews is what a guest is shown. `api/admin.php` never writes what the browser sends: it rebuilds the file field by field from values it has validated itself, keeps the metadata, and writes a `.bak` before swapping the new file in.

The folder is called `manage` rather than `admin` so the usual bot sweeps for `/admin` and `/wp-admin` find nothing. That is noise reduction, not a secret — this repository is public, so the name is readable by anyone who looks. **The password is what actually protects it.** If you want an address that is genuinely private, rename the folder on the server to anything you like; everything inside uses relative links, so a rename needs no other edit.

`assets/data/` must be writable for saving to work. The panel says so on screen if it is not.

### `.htaccess`

`server/.htaccess` forces HTTPS and one hostname, sets the cache and security headers, hides `config.php`, and **301-redirects every URL the old WordPress site had** — `/accommodation/apartment-h1/` to `/apartments/h1/`, `/our-gallery/` to `/gallery/`, and so on down the old sitemap, so existing links and search results keep working.

## Prices

Every season in all three calendar files carries `"price": null`, because the 2027 rates are not set yet. While that is true:

- the calendar still shows what is free
- the rate cards say "rate on request"
- a quote **refuses** rather than inventing a total

Fill the numbers into the three files and everything else follows.

## Contact

Benjamina Udovičića 3b, 22211 Vodice, Croatia
+385 91 7934 470 · +385 91 7396 359 · apartment.hope.vodice@gmail.com

## The apartments

| | H1 | H2 | H3 |
|---|---|---|---|
| Guests | 4 | 4 | 6 |
| Size | 40 m² | 40 m² | 70 m² |
| Beds | double + sofa bed + child bed | double + sofa bed | 2 doubles, 2 bedrooms |
| Extra | kamado charcoal grill | kitchen with stove | 33 m² private balcony, top floor |

All three: air conditioning, free Wi-Fi, hairdryer, in-room safe, kamado grill, kitchen.

## Brand

The lighthouse is the letter **E** in HOPE. Files and usage rules in [`hope-vodice/assets/logo/README.md`](hope-vodice/assets/logo/README.md), tokens in [`hope-vodice/assets/brand.css`](hope-vodice/assets/brand.css).

| | |
|---|---|
| Blue | `#0B7FC4` |
| Gold | `#E8A838` |
| Deep | `#0A2E45` |
| Type | Montserrat 800 · Jost 300/400/500 |

## Still open

1. **Nightly rates** for all three apartments, and the minimum stays
2. **New photographs of H2** — the existing ones are 320×240, too small for anything but a thumbnail
3. **Ten unassigned photos** in `tools/sources.json` that were in the old media library but on no apartment page
4. **Distance to the beach** — the old site said 600 m in one place and 800 m in another; 600 m is used here
5. **Booking terms** — the 15% deposit and 30-day cancellation are carried over from the old site, unverified
6. **Croatian, German and Italian** versions; the site is English only, as the old one was
7. **The contact form needs PHP.** `api/contact.php` is not written yet, and Vercel cannot run it. On Vercel the form will fail and tell the visitor to write directly.
