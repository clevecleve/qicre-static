#!/usr/bin/env node
'use strict';

const { chromium }  = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio       = require('cheerio');
const path          = require('path');
const fse           = require('fs-extra');
const { URL }       = require('url');

chromium.use(StealthPlugin());

// ── Config ─────────────────────────────────────────────────────────────────
const ORIGIN    = 'https://www.qicre.com';
const OUT_DIR   = path.resolve(__dirname, 'dist');
const DELAY_MS  = 1500;
const TIMEOUT   = 60_000;
const MAX_PAGES = 500;

// ── URL helpers ────────────────────────────────────────────────────────────

const HTML_EXTS = new Set(['', '.html', '.htm', '.php', '.asp', '.aspx']);

function isPage(rawUrl) {
  try {
    const ext = path.extname(new URL(rawUrl).pathname).toLowerCase();
    return HTML_EXTS.has(ext);
  } catch { return false; }
}

function urlToFilePath(rawUrl) {
  const u   = new URL(rawUrl, ORIGIN);
  let p     = u.pathname;
  const ext = path.extname(p).toLowerCase();
  if (HTML_EXTS.has(ext)) {
    p = (p.replace(/\/$/, '') || '') + '/index.html';
  }
  return path.join(OUT_DIR, p);
}

// Bare origin (no www) is also treated as same-origin
const ORIGIN_BARE = ORIGIN.replace('://www.', '://');

function rewriteOne(raw, base) {
  if (!raw) return raw;
  if (/^(data:|#|mailto:|tel:|javascript:)/i.test(raw)) return raw;
  try {
    const u = new URL(raw, base);
    if (u.origin !== ORIGIN && u.origin !== ORIGIN_BARE) return raw;
    return u.pathname; // drop query string — filter pages aren't in the static site
  } catch { return raw; }
}

// ── HTML rewriting ─────────────────────────────────────────────────────────

// Small vanilla JS injected into every page.
// Handles the mobile hamburger toggle since we've stripped React.
const VANILLA_NAV_JS = `
<script>
(function () {
  var toggler = document.querySelector('.navbar-toggler');
  var collapse = document.querySelector('.navbar-collapse');
  if (toggler && collapse) {
    toggler.addEventListener('click', function () {
      collapse.classList.toggle('show');
    });
  }
})();
</script>`;

function rewriteHtml(html, pageUrl) {
  const $  = cheerio.load(html, { decodeEntities: false });
  const rw = v => rewriteOne(v, pageUrl);

  // Rewrite asset URLs to root-relative
  ['src', 'data-src', 'data-lazy-src', 'data-bg'].forEach(attr =>
    $(`[${attr}]`).each((_, el) => {
      const v = $(el).attr(attr);
      if (v) $(el).attr(attr, rw(v));
    })
  );

  ['href', 'action'].forEach(attr =>
    $(`[${attr}]`).each((_, el) => {
      const v = $(el).attr(attr);
      if (v) $(el).attr(attr, rw(v));
    })
  );

  $('[srcset]').each((_, el) => {
    const val = $(el).attr('srcset') || '';
    const out = val.split(',').map(part => {
      const t  = part.trim();
      const sp = t.search(/\s/);
      if (sp === -1) return rw(t);
      return rw(t.slice(0, sp)) + t.slice(sp);
    }).join(', ');
    $(el).attr('srcset', out);
  });

  const rwCss = css =>
    css.replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g, (_, q, u) =>
      `url(${q}${rw(u)}${q})`);

  $('[style]').each((_, el) =>
    $(el).attr('style', rwCss($(el).attr('style') || '')));

  $('style').each((_, el) =>
    $(el).html(rwCss($(el).html() || '')));

  // ── Static-site fixes ───────────────────────────────────────────────────

  // 1. Strip React bootstrap — keeps the SSR-rendered content in place
  $('script[src*="/dist/retailer/static/js/main"]').remove();
  $('script[src*="/dist/retailer/static/js/runtime"]').remove();
  $('script[src*="/dist/consumer/static/js/main"]').remove();
  $('script[src*="/dist/consumer/static/js/runtime"]').remove();

  // 2. Remove the promotional lightbox popup (it can't be dismissed without React)
  $('.lightbox-main-wrapper').remove();

  // 3. Strip the is-shrink class and inline top style from the sticky nav
  //    so it doesn't render in a broken half-visible state
  $('.sticky-navbar').removeClass('is-shrink').removeAttr('style');

  // 4. Fix frozen Flickity carousels: reset slider transform, show first slide only
  $('.flickity-slider').each((_, slider) => {
    $(slider).removeAttr('style');
    $(slider).children().each((i, child) => {
      $(child).removeAttr('style').removeAttr('aria-hidden');
      if (i > 0) $(child).css('display', 'none');
    });
  });
  $('.flickity-viewport').css({ height: 'auto', overflow: 'hidden' });

  // 5. Inject vanilla JS for the mobile hamburger toggle
  $('body').append(VANILLA_NAV_JS);

  return $.html();
}

// ── CSS rewriting ──────────────────────────────────────────────────────────

function rewriteCss(css, cssUrl) {
  return css
    .replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g, (_, q, u) =>
      `url(${q}${rewriteOne(u, cssUrl)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/g, (_, q, u) =>
      `@import ${q}${rewriteOne(u, cssUrl)}${q}`);
}

// ── Link extraction ────────────────────────────────────────────────────────

function extractLinks(html, base) {
  const $     = cheerio.load(html);
  const links = new Set();
  $('a[href]').each((_, el) => {
    try {
      const u = new URL($(el).attr('href'), base);
      if (u.origin === ORIGIN) links.add(u.origin + u.pathname);
    } catch {}
  });
  return [...links];
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  await fse.ensureDir(OUT_DIR);
  console.log(`\nCrawling ${ORIGIN}\n→ ${OUT_DIR}\n`);

  const visited = new Set();
  const saved   = new Set();
  const queue   = [`${ORIGIN}/`];

  const browser = await chromium.launch({ headless: true });
  const ctx     = await browser.newContext({
    userAgent: [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      'AppleWebKit/537.36 (KHTML, like Gecko)',
      'Chrome/124.0.0.0 Safari/537.36',
    ].join(' '),
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });

  // Capture all same-origin asset responses
  ctx.on('response', async resp => {
    const raw  = resp.url();
    const url  = raw.split('?')[0].split('#')[0];
    if (!url.startsWith(ORIGIN) || saved.has(url)) return;
    saved.add(url);

    const ct = resp.headers()['content-type'] || '';
    if (ct.includes('text/html')) return;

    try {
      const buf     = await resp.body();
      const outPath = path.join(OUT_DIR, new URL(url).pathname);
      await fse.ensureDir(path.dirname(outPath));
      if (ct.includes('text/css')) {
        await fse.writeFile(outPath, rewriteCss(buf.toString('utf8'), url), 'utf8');
      } else {
        await fse.writeFile(outPath, buf);
      }
    } catch { /* already consumed or network error */ }
  });

  let count = 0;

  while (queue.length && count < MAX_PAGES) {
    const pageUrl = queue.shift();
    const key     = pageUrl.split('?')[0].split('#')[0];
    if (visited.has(key)) continue;
    visited.add(key);
    count++;

    console.log(`[${count}] ${pageUrl}`);

    const page = await ctx.newPage();
    try {
      await page.goto(pageUrl, { waitUntil: 'load', timeout: TIMEOUT });

      // Scroll to bottom to trigger lazy-loaded images and content
      await page.evaluate(async () => {
        await new Promise(resolve => {
          const distance = 400;
          const delay    = 120;
          let scrolled   = 0;
          const tick = () => {
            window.scrollBy(0, distance);
            scrolled += distance;
            if (scrolled < document.body.scrollHeight) {
              setTimeout(tick, delay);
            } else {
              resolve();
            }
          };
          tick();
        });
      });

      await page.waitForTimeout(DELAY_MS);

      // Return to top, move mouse away from nav before capturing
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.mouse.move(0, 0);
      await page.waitForTimeout(300);

      const html = await page.content();

      for (const link of extractLinks(html, pageUrl)) {
        if (!visited.has(link) && isPage(link)) queue.push(link);
      }

      const outPath = urlToFilePath(pageUrl);
      await fse.ensureDir(path.dirname(outPath));
      await fse.writeFile(outPath, rewriteHtml(html, pageUrl), 'utf8');
    } catch (err) {
      console.warn(`  SKIP ${pageUrl}: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  if (count >= MAX_PAGES) {
    console.log(`\nReached MAX_PAGES limit (${MAX_PAGES}). Increase if needed.`);
  }
  console.log(`\nDone! ${count} pages saved → ${OUT_DIR}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
