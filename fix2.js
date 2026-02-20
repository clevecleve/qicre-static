#!/usr/bin/env node
'use strict';

/**
 * fix2.js — second-pass static site fixes for qicre.com
 *
 * Applies on top of the already-processed dist/ folder:
 *   1.  Fix broken ESG 2022 internal links (missing /Our-Progress/ segment)
 *   2.  Fix remaining absolute qicre.com links that slipped through
 *   3.  Remove target="_blank" from footer Privacy-Policy / Disclaimer links
 *   4.  Replace broken jssmedia favicon refs with a fallback SVG favicon
 *   5.  Inject static-fixes.css + static-fixes.js into every page
 *   6.  Add meta-refresh redirect to all ~/link.aspx pages
 *   7.  Fix /Places/castle-towers → /Places/Castle-Towers directory + all links
 *   8.  Rename the castle-towers directory to match title-case
 */

const cheerio = require('cheerio');
const path    = require('path');
const fse     = require('fs-extra');
const glob    = require('glob');

const OUT_DIR = path.resolve(__dirname, 'dist');

// SVG favicon data-URI — a simple black square with white "Q"
const FAVICON_SVG = [
  "data:image/svg+xml,",
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>",
  "<rect width='100' height='100' fill='%23000'/>",
  "<text x='50%25' y='72%25' text-anchor='middle' fill='white'",
  " font-family='Georgia,serif' font-size='65' font-weight='bold'>Q</text>",
  "</svg>",
].join('');

// Snippet injected into every <head> (right before </head>)
const HEAD_INJECT = `
  <link rel="stylesheet" href="/static-fixes.css">`;

// Snippet injected at the end of every <body>
const BODY_INJECT = `
  <script src="/static-fixes.js" defer=""></script>`;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Given an HTML file path, return the "depth" relative to OUT_DIR
 * so we can calculate a relative redirect URL.
 * e.g. OUT_DIR/ESG/2022-ESG-report/~/link.aspx/index.html → depth 4
 */
function depthFromRoot(filePath) {
  const rel = path.relative(OUT_DIR, filePath);
  return rel.split(path.sep).length - 1; // subtract 1 for index.html itself
}

function parentPath(filePath) {
  // e.g. /ESG/2022-ESG-report/~/link.aspx/index.html → /ESG/2022-ESG-report/
  const rel = path.relative(OUT_DIR, filePath); // e.g. ESG/2022-ESG-report/~/link.aspx/index.html
  const parts = rel.split(path.sep);
  // Remove the trailing index.html and the ~/link.aspx segment (and possibly the ~ segment)
  // The page lives at e.g. ESG/2022-ESG-report/~/link.aspx/index.html
  // We want to redirect to    /ESG/2022-ESG-report/
  const filtered = parts.filter(p => p !== 'index.html' && p !== 'link.aspx' && p !== '~');
  return '/' + filtered.join('/') + (filtered.length ? '/' : '');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const files = glob.sync('**/*.html', { cwd: OUT_DIR, absolute: true });
  console.log(`fix2: processing ${files.length} HTML files…\n`);

  let fixed = 0;

  for (const file of files) {
    const html = await fse.readFile(file, 'utf8');
    const $ = cheerio.load(html, { decodeEntities: false });

    const isLinkAspx = file.includes('link.aspx');
    const rel = path.relative(OUT_DIR, file);

    // ── 1. Fix broken ESG 2022 links ──────────────────────────────────────
    // /ESG/2022-ESG-report/Climate-change → /ESG/2022-ESG-report/Our-Progress/Climate-change
    // /ESG/2022-ESG-report/Community-investment → /ESG/2022-ESG-report/Our-Progress/Community-investment
    $('a[href]').each((_, el) => {
      let href = $(el).attr('href') || '';
      if (/\/ESG\/2022-ESG-report\/Climate-change\b/i.test(href)) {
        href = href.replace(
          /\/ESG\/2022-ESG-report\/Climate-change/i,
          '/ESG/2022-ESG-report/Our-Progress/Climate-change'
        );
        $(el).attr('href', href);
      }
      if (/\/ESG\/2022-ESG-report\/Community-investment\b/i.test(href)) {
        href = href.replace(
          /\/ESG\/2022-ESG-report\/Community-investment/i,
          '/ESG/2022-ESG-report/Our-Progress/Community-investment'
        );
        $(el).attr('href', href);
      }
    });

    // ── 2. Fix any remaining absolute qicre.com links ─────────────────────
    $('a[href]').each((_, el) => {
      let href = $(el).attr('href') || '';
      if (/^https?:\/\/(www\.)?qicre\.com/i.test(href)) {
        try {
          const u = new URL(href);
          // Keep only the pathname (drop query string — static site can't filter)
          $(el).attr('href', u.pathname || '/');
        } catch { /* skip malformed */ }
      }
    });

    // ── 3. Remove target="_blank" from footer Privacy / Disclaimer links ───
    $('a[href="/Privacy-Policy"], a[href="/privacy-policy"]').each((_, el) => {
      $(el).removeAttr('target').removeAttr('rel');
    });
    $('a[href="/Disclaimer"], a[href="/disclaimer"]').each((_, el) => {
      $(el).removeAttr('target').removeAttr('rel');
    });

    // ── 4. Replace broken jssmedia favicon links with SVG fallback ─────────
    $('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href.includes('jssmedia')) {
        $(el).remove();
      }
    });
    // Inject a single fallback favicon (only once — check it's not already there)
    if (!$('link[href^="data:image/svg+xml"]').length) {
      $('head').prepend(`<link rel="icon" href="${FAVICON_SVG}">`);
    }

    // ── 5. Inject static-fixes.css + static-fixes.js ──────────────────────
    if (!$('link[href="/static-fixes.css"]').length) {
      $('head').append(HEAD_INJECT);
    }
    if (!$('script[src="/static-fixes.js"]').length) {
      $('body').append(BODY_INJECT);
    }

    // ── 6. ~/link.aspx pages → redirect to parent ─────────────────────────
    if (isLinkAspx) {
      const redirect = parentPath(file);
      // Replace the entire <head> meta with a redirect
      $('head').prepend(`<meta http-equiv="refresh" content="0; url=${redirect}">`);
      // Also inject a visible fallback link in case meta-refresh is blocked
      const bodyHtml = `
<div style="font-family:sans-serif;padding:40px 20px;text-align:center;">
  <p>Redirecting… <a href="${redirect}">Click here if not redirected</a></p>
</div>`;
      $('body').prepend(bodyHtml);
    }

    // ── 7. Fix /Places/castle-towers → /Places/Castle-Towers links ────────
    $('a[href]').each((_, el) => {
      let href = $(el).attr('href') || '';
      if (/\/places\/castle-towers/i.test(href) && !/\/Places\/Castle-Towers/.test(href)) {
        $(el).attr('href', href.replace(/\/places\/castle-towers/i, '/Places/Castle-Towers'));
      }
    });

    await fse.writeFile(file, $.html(), 'utf8');
    fixed++;

    if (fixed % 25 === 0) console.log(`  … ${fixed}/${files.length}`);
  }

  // ── 8. Rename /Places/castle-towers → /Places/Castle-Towers directory ────
  const oldDir = path.join(OUT_DIR, 'Places', 'castle-towers');
  const newDir = path.join(OUT_DIR, 'Places', 'Castle-Towers');
  if (await fse.pathExists(oldDir) && !(await fse.pathExists(newDir))) {
    await fse.move(oldDir, newDir);
    console.log('\n  Renamed Places/castle-towers → Places/Castle-Towers');
  }

  console.log(`\nfix2 done — updated ${fixed} files.`);
}

main().catch(err => { console.error(err); process.exit(1); });
