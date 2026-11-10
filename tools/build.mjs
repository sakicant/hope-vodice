/**
 * Hope Apartments static site builder.
 *
 *   node tools/build.mjs
 *
 * Reads  src/layout.html + src/pages/*.html + src/data/*.json
 * Writes plain static HTML to the repo root.
 *
 * No dependencies on purpose: this must still build in five years.
 *
 * The one thing this builder knows that a single-property builder does not:
 * there are three apartments, each with its own calendar and its own prices.
 * A page declares "apartment": "h2" in its meta block and gets {{apt.*}} plus
 * a calendar bound to that apartment's own data file.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const site = JSON.parse(read('src/data/site.json'));

/**
 * Where the site is served from.
 *
 * "" means the domain root. "/hope-vodice" means every page and asset lives
 * under that path, and the built tree goes into a folder of the same name, so
 * the local preview and the Vercel deploy resolve identically with no rewrite
 * rules in between. One setting moves both.
 */
const BASE = (process.env.HOPE_BASE ?? site.base ?? '').replace(/\/+$/, '');
const OUTDIR = process.env.HOPE_OUT || (BASE ? BASE.replace(/^\//, '') : '.');
const out = (...p) => join(ROOT, OUTDIR, ...p);

/**
 * The directory that is the web root.
 *
 * With a base path the site sits in a folder inside the web root, so
 * robots.txt belongs one level up. Without one the output folder IS the web
 * root. tools/package.py builds with HOPE_BASE="" and HOPE_OUT=dist/site to
 * get the copy the PHP host wants.
 */
const WEBROOT = BASE ? ROOT : join(ROOT, OUTDIR);

const icons = JSON.parse(read('src/data/icons.json'));
const manifest = JSON.parse(readFileSync(out('assets/img/manifest.json'), 'utf8'));
const layout = read('src/layout.html');

/**
 * An absolute URL for canonicals, Open Graph and structured data.
 *
 * Deliberately without BASE: those tags say where a page lives on the real
 * site, and the base path is a deployment detail of the review copy. A review
 * build that claimed hope-vodice.com/hope-vodice/ would be naming a URL that
 * is never going to exist.
 */
const absUrl = (p) => site.origin + p;

const apartments = site.apartments;
const byId = Object.fromEntries(apartments.map((a) => [a.id, a]));

/* ---------- helpers ------------------------------------------------------ */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const attrs = (s) => (n) => (s.match(new RegExp(`${n}="([^"]*)"`)) || [, ''])[1];

/** Parse the leading <!--meta { ... } --> block off a page source. */
function splitMeta(src, file) {
  const m = src.match(/^\s*<!--meta\s*([\s\S]*?)-->\s*/);
  if (!m) throw new Error(`${file} is missing its <!--meta --> block`);
  try {
    return { meta: JSON.parse(m[1]), body: src.slice(m[0].length) };
  } catch (e) {
    throw new Error(`${file}: meta block is not valid JSON - ${e.message}`);
  }
}

const warnings = [];

/**
 * Expand <x-img src="h3-balcony" ...> into a responsive <img>.
 * Attributes: src (manifest key), alt, sizes, class, ratio ("4/3"), priority.
 *
 * A photo under 900 px wide cannot fill a hero, so asking for one in a
 * full-width slot is reported rather than silently upscaled into mush.
 */
function expandImages(html, where) {
  return html.replace(/<x-img\s+([^>]*?)\/?>/g, (full, a) => {
    const get = attrs(a);
    const key = get('src');
    const entry = manifest[key];
    if (!entry) throw new Error(`${where}: unknown image "${key}"`);

    const sizes = get('sizes') || '100vw';
    const cls = get('class');
    const ratio = get('ratio');
    const priority = /\bpriority\b/.test(a);

    if (entry.lowres && /100vw|^\(min-width:\s*\d+px\)\s*[5-9]\d vw/.test(sizes)) {
      warnings.push(`${where}: "${key}" is only ${entry.w}px wide but sits in a ${sizes} slot`);
    }

    const srcset = entry.variants.map((w) => `/assets/img/r/${key}-${w}.webp ${w}w`).join(', ');
    const fallback = `/assets/img/r/${key}-${entry.max}.webp`;

    let [w, h] = [entry.w, entry.h];
    if (ratio) {
      const [rw, rh] = ratio.split('/').map(Number);
      h = Math.round((w * rh) / rw);
    }

    return (
      `<img src="${fallback}" srcset="${srcset}" sizes="${sizes}" ` +
      `width="${w}" height="${h}" alt="${esc(get('alt'))}"` +
      (cls ? ` class="${cls}"` : '') +
      (priority ? ' fetchpriority="high" decoding="async">' : ' loading="lazy" decoding="async">')
    );
  });
}

/** Expand <x-photo> into a lightbox-openable tile. Emits <x-img>, so run first. */
function expandPhotos(html, where) {
  return html.replace(/<x-photo\s+([^>]*?)\/?>/g, (full, a) => {
    const get = attrs(a);
    const key = get('src');
    const entry = manifest[key];
    if (!entry) throw new Error(`${where}: unknown image "${key}"`);
    const alt = get('alt');
    const sizes = get('sizes') || '(min-width: 1000px) 30vw, (min-width: 640px) 45vw, 92vw';
    return (
      `<button class="gal__item" type="button" data-full="/assets/img/r/${key}-${entry.max}.webp" ` +
      `data-cap="${esc(alt)}">` +
      `<x-img src="${key}" alt="${esc(alt)}" sizes="${sizes}" ratio="4/3" /></button>`
    );
  });
}

/** Expand a whole apartment's gallery from site.json, so it is written once. */
function expandAptGallery(html, where) {
  return html.replace(/<x-apt-gallery\s+id="([^"]+)"\s*\/?>/g, (full, id) => {
    const apt = byId[id];
    if (!apt) throw new Error(`${where}: unknown apartment "${id}"`);
    return apt.gallery
      .map((g) => `<x-photo src="${g.src}" alt="${esc(g.alt)}" />`)
      .join('\n      ');
  });
}

/** The three apartment cards, used on the home page and on /apartments/. */
function expandAptCards(html) {
  return html.replace(/<x-apt-cards\s*([^>]*?)\/?>/g, (full, a) => {
    const only = attrs(a)('exclude');
    return apartments
      .filter((apt) => apt.id !== only)
      .map(
        (apt) => `<article class="aptcard">
        <a class="aptcard__media" href="${apt.slug}" tabindex="-1" aria-hidden="true">
          <x-img src="${apt.hero}" alt="" sizes="(min-width: 980px) 32vw, (min-width: 640px) 46vw, 92vw" ratio="4/3" />
        </a>
        <div class="aptcard__body">
          <span class="aptcard__tag">${apt.guests} guests · ${apt.size} m²</span>
          <h3><a href="${apt.slug}">${apt.name}</a></h3>
          <p>${apt.blurb}</p>
          <ul class="aptcard__facts">
            <li><x-icon name="bed" /> ${apt.beds}</li>
            <li><x-icon name="door" /> ${apt.bedrooms === 1 ? 'Open-plan, one sleeping area' : apt.bedrooms + ' separate bedrooms'}</li>
            <li><x-icon name="star" /> ${apt.feature}</li>
          </ul>
          <div class="aptcard__actions">
            <a class="btn btn--ghost" href="${apt.slug}">More details</a>
            <a class="btn btn--primary" href="${apt.slug}#calendar">Book now <x-icon name="calendar" /></a>
          </div>
        </div>
      </article>`
      )
      .join('\n      ');
  });
}

/** Expand <x-icon name="wifi"> into an inline SVG from icons.json. */
function expandIcons(html, where) {
  return html.replace(/<x-icon\s+name="([^"]+)"\s*\/?>/g, (full, name) => {
    const path = icons[name];
    if (!path) throw new Error(`${where}: unknown icon "${name}"`);
    return (
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ` +
      `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
    );
  });
}

/** Expand <x-faq> into the accordion, sourced from site.json. */
function expandFaq(html) {
  return html.replace(/<x-faq\s*([^>]*?)\/?>/g, (full, a) => {
    const get = attrs(a);
    const limit = Number(get('limit')) || Infinity;
    const showGroups = get('groups') !== 'false';
    const only = get('group');
    const source = only === '' ? site.faq : [site.faq[Number(only)]];

    let n = 0;
    const out = [];
    for (const group of source) {
      if (n >= limit) break;
      const items = group.items.slice(0, limit - n);
      n += items.length;
      if (showGroups) out.push(`<h2 class="faq__group">${group.title}</h2>`);
      for (const it of items) {
        out.push(`<details>\n  <summary>${it.q}</summary>\n  <div class="faq__a">${it.a}</div>\n</details>`);
      }
    }
    return out.join('\n');
  });
}

/* ---------- cache busting ------------------------------------------------ */

const FINGERPRINTED = [
  '/assets/css/main.css',
  '/assets/js/main.js',
  '/assets/js/calendar-core.js',
  '/assets/logo/logo-horizontal.svg',
  '/assets/logo/logo-horizontal-white.svg',
  '/assets/logo/favicon.svg'
];

const fingerprints = new Map(
  FINGERPRINTED.map((p) => {
    const file = out(p.replace(/^\//, ''));
    if (!existsSync(file)) return [p, null];
    return [p, createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 8)];
  })
);

function fingerprintAssets(html) {
  for (const [path, hash] of fingerprints) {
    if (!hash) continue;
    html = html.split(`"${path}"`).join(`"${path}?v=${hash}"`);
  }
  return html;
}

/**
 * Push every internal URL under BASE.
 *
 * Runs last, once, over the finished page. Internal links are the ones that
 * start with a single slash; anything with a scheme, a protocol-relative "//",
 * a fragment or a mailto/tel is left alone. srcset carries several URLs in one
 * attribute, so it gets its own pass.
 */
function prefixUrls(html) {
  if (!BASE) return html;
  // One pass, anchored on the whitespace before the attribute name. Without
  // that anchor `src="` also matches the tail of `data-cal-src="`, and the
  // value comes out prefixed twice.
  //
  // Not `content`: Open Graph and canonical already carry the full origin, and
  // a meta description that happened to start with a slash would be mangled.
  const ATTRS = 'href|src|action|data-full|data-cal-src|data-from-src';
  html = html.replace(new RegExp(`(\\s)(${ATTRS})="/(?!/)`, 'g'), `$1$2="${BASE}/`);
  html = html.replace(/srcset="([^"]+)"/g, (full, value) =>
    `srcset="${value.replace(/(^|,\s*)\/(?!\/)/g, `$1${BASE}/`)}"`);
  return html;
}

/**
 * Keep width/height on inline SVG logos in step with their viewBox, so the
 * header reserves the right box before the file loads and nothing jumps.
 */
function syncSvgDimensions(html) {
  return html.replace(/<img([^>]*?)src="(\/assets\/logo\/[^"?]+\.svg)([^"]*)"([^>]*?)>/g,
    (tag, before, src, query, after) => {
      const file = out(src.replace(/^\//, ''));
      if (!existsSync(file)) return tag;
      const box = readFileSync(file, 'utf8').match(/viewBox="([\d.\s-]+)"/);
      if (!box) return tag;
      const n = box[1].trim().split(/\s+/).map(Number);
      const [w, h] = [Math.round(n[2]), Math.round(n[3])];
      const rest = (before + after).replace(/\s*width="[^"]*"/, '').replace(/\s*height="[^"]*"/, '');
      return `<img${rest} src="${src}${query}" width="${w}" height="${h}">`;
    });
}

/** {{site.phone}} / {{apt.name}} interpolation against a scope object. */
function interpolate(tpl, scope) {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (full, path) => {
    const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), scope);
    return v == null ? '' : String(v);
  });
}

/* ---------- nav ---------------------------------------------------------- */

function navHtml(current, mobile) {
  const links = site.nav
    .map((n) => {
      const cur = n.url === current || (n.url !== '/' && current.startsWith(n.url))
        ? ' aria-current="page"' : '';
      return `<a href="${n.url}"${cur}>${n.label}</a>`;
    })
    .join('\n        ');
  return mobile
    ? `${links}\n        <a class="btn btn--primary" href="/apartments/">Check availability</a>`
    : links;
}

/* ---------- structured data --------------------------------------------- */

function jsonLd(meta) {
  const image = (key) => absUrl(`/assets/img/r/${key}-${manifest[key].max}.webp`);

  const lodging = {
    '@type': 'LodgingBusiness',
    '@id': absUrl('/#lodging'),
    name: site.name,
    url: `${site.origin}/`,
    description: site.description,
    telephone: site.phone,
    email: site.email,
    image: [image('h3-balcony'), image('h1-balcony')],
    priceRange: '€€',
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.address.street,
      addressLocality: site.address.locality,
      postalCode: site.address.postalCode,
      addressRegion: 'Šibenik-Knin',
      addressCountry: 'HR'
    },
    geo: { '@type': 'GeoCoordinates', latitude: site.geo.lat, longitude: site.geo.lng },
    numberOfRooms: apartments.length,
    checkinTime: site.checkIn,
    checkoutTime: site.checkOut,
    knowsLanguage: ['hr', 'en', 'de'],
    sameAs: [site.booking, site.tripadvisor, site.facebook],
    amenityFeature: site.amenityFeatures.map((n) => ({
      '@type': 'LocationFeatureSpecification', name: n, value: true
    })),
    containsPlace: apartments.map((apt) => ({
      '@type': 'Accommodation',
      '@id': absUrl(apt.slug + '#accommodation'),
      name: apt.name,
      url: absUrl(apt.slug),
      description: apt.blurb,
      occupancy: { '@type': 'QuantitativeValue', maxValue: apt.guests, unitText: 'guests' },
      floorSize: { '@type': 'QuantitativeValue', value: apt.size, unitCode: 'MTK' },
      numberOfBedrooms: apt.bedrooms,
      numberOfBathroomsTotal: apt.bathrooms,
      image: [image(apt.hero)]
    }))
  };

  const graph = [
    lodging,
    { '@type': 'WebSite', '@id': absUrl('/#website'), url: absUrl('/'), name: site.name, inLanguage: 'en' }
  ];

  if (meta.faq) {
    graph.push({
      '@type': 'FAQPage',
      '@id': absUrl(meta.url + '#faq'),
      mainEntity: site.faq.flatMap((g) =>
        g.items.map((q) => ({
          '@type': 'Question',
          name: q.q,
          acceptedAnswer: { '@type': 'Answer', text: q.a.replace(/<[^>]+>/g, '') }
        })))
    });
  }

  if (meta.url !== '/') {
    const trail = [{ '@type': 'ListItem', position: 1, name: 'Home', item: absUrl('/') }];
    if (meta.apartment) {
      trail.push({ '@type': 'ListItem', position: 2, name: 'Apartments', item: absUrl('/apartments/') });
      trail.push({ '@type': 'ListItem', position: 3, name: meta.crumb || meta.h1 });
    } else {
      trail.push({ '@type': 'ListItem', position: 2, name: meta.crumb || meta.h1 });
    }
    graph.push({ '@type': 'BreadcrumbList', itemListElement: trail });
  }

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}

/* ---------- page render -------------------------------------------------- */

const pagesDir = join(ROOT, 'src/pages');
const built = [];

for (const file of readdirSync(pagesDir).filter((f) => f.endsWith('.html'))) {
  const { meta, body } = splitMeta(readFileSync(join(pagesDir, file), 'utf8'), file);
  meta.robots = meta.noindex
    ? 'noindex, follow'
    : 'index, follow, max-image-preview:large, max-snippet:-1';

  meta.canonical = absUrl(meta.url === '/404.html' ? '/404.html' : meta.url);
  meta.ogImageUrl = meta.ogImage && manifest[meta.ogImage]
    ? absUrl(`/assets/img/r/${meta.ogImage}-${Math.min(1200, manifest[meta.ogImage].max)}.webp`)
    : '';

  const apt = meta.apartment ? byId[meta.apartment] : null;
  if (meta.apartment && !apt) throw new Error(`${file}: unknown apartment "${meta.apartment}"`);
  const scope = { site, page: meta, apt };

  let content = interpolate(body, scope);
  content = expandAptCards(content);
  content = expandAptGallery(content, file);
  content = expandFaq(content);
  content = expandPhotos(content, file);
  content = expandImages(content, file);
  content = expandIcons(content, file);

  let html = layout
    .replace('{{content}}', content)
    .replace('{{nav}}', navHtml(meta.url, false))
    .replace('{{navMobile}}', navHtml(meta.url, true))
    .replace('{{jsonld}}', jsonLd(meta));
  html = expandIcons(interpolate(html, scope), file);
  html = syncSvgDimensions(html);
  html = fingerprintAssets(html);
  html = prefixUrls(html);

  const outPath =
    meta.url === '/' ? 'index.html'
      : meta.url.endsWith('.html') ? meta.url.slice(1)
        : join(meta.url.replace(/^\/|\/$/g, ''), 'index.html');
  const dest = out(outPath);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, html);
  if (!meta.noindex) built.push({ url: meta.url, out: outPath, bytes: Buffer.byteLength(html) });
}

/* ---------- sitemap + robots -------------------------------------------- */

const today = new Date().toISOString().slice(0, 10);
const priority = (u) => (u === '/' ? '1.0' : u.startsWith('/apartments') ? '0.9' : '0.7');

writeFileSync(out('sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  built
    .sort((a, b) => (a.url === '/' ? -1 : b.url === '/' ? 1 : a.url.localeCompare(b.url)))
    .map((p) =>
      `  <url>\n    <loc>${site.origin}${p.url}</loc>\n    <lastmod>${today}</lastmod>\n` +
      `    <priority>${priority(p.url)}</priority>\n  </url>`)
    .join('\n') + `\n</urlset>\n`);

/**
 * robots.txt belongs at the real web root, not inside the base folder.
 *
 * A build under a base path is a review copy on someone else's domain. Letting
 * it be indexed would put a second, identical site in front of the same
 * searches, so it asks to be left alone instead.
 */
writeFileSync(join(WEBROOT, 'robots.txt'), BASE
  ? `# Review build, served under ${BASE}/ on a preview domain.\n` +
    `# Not the live site. Keep it out of search.\n\n` +
    `User-agent: *\nDisallow: /\n`
  : `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}/sitemap.xml\n`);

/* ---------- report ------------------------------------------------------- */

console.log(`built into ${OUTDIR === '.' ? 'the repository root' : OUTDIR + '/'}, served from ${BASE || '/'}:`);
for (const p of built.sort((a, b) => a.url.localeCompare(b.url))) {
  console.log(`  ${p.url.padEnd(22)} ${String(Math.round(p.bytes / 1024)).padStart(4)} KB  ${p.out}`);
}
console.log('  sitemap.xml, robots.txt');

if (warnings.length) {
  console.log(`\n${warnings.length} image warning(s):`);
  for (const w of warnings) console.log('  ' + w);
}
