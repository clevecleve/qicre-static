#!/usr/bin/env node
'use strict';

const cheerio = require('cheerio');
const path    = require('path');
const fse     = require('fs-extra');
const glob    = require('glob');
const { URL } = require('url');

const ORIGIN      = 'https://www.qicre.com';
const ORIGIN_BARE = 'https://qicre.com';
const OUT_DIR     = path.resolve(__dirname, 'dist');

function rewriteOne(raw, base) {
  if (!raw) return raw;
  if (/^(data:|#|mailto:|tel:|javascript:)/i.test(raw)) return raw;
  try {
    const u = new URL(raw, base || ORIGIN);
    if (u.origin !== ORIGIN && u.origin !== ORIGIN_BARE) return raw;
    return u.pathname;
  } catch { return raw; }
}

async function main() {
  const files = glob.sync('**/*.html', { cwd: OUT_DIR, absolute: true });
  console.log(`Post-processing ${files.length} HTML files…`);

  let fixed = 0;
  for (const file of files) {
    const html = await fse.readFile(file, 'utf8');
    const $    = cheerio.load(html, { decodeEntities: false });
    const pageUrl = ORIGIN + '/' + path.relative(OUT_DIR, file).replace(/index\.html$/, '').replace(/\\/g, '/');
    const rw = v => rewriteOne(v, pageUrl);

    // Strip React
    $('script[src*="/dist/retailer/static/js/main"]').remove();
    $('script[src*="/dist/retailer/static/js/runtime"]').remove();
    $('script[src*="/dist/consumer/static/js/main"]').remove();
    $('script[src*="/dist/consumer/static/js/runtime"]').remove();

    // Rewrite any remaining absolute same-origin links
    ['href', 'action'].forEach(attr =>
      $(`[${attr}]`).each((_, el) => {
        const v = $(el).attr(attr);
        if (v && (v.includes('://qicre.com') || v.includes('://www.qicre.com'))) {
          $(el).attr(attr, rw(v));
        }
      })
    );
    ['src', 'data-src'].forEach(attr =>
      $(`[${attr}]`).each((_, el) => {
        const v = $(el).attr(attr);
        if (v && (v.includes('://qicre.com') || v.includes('://www.qicre.com'))) {
          $(el).attr(attr, rw(v));
        }
      })
    );

    // Fix Flickity carousels
    if (html.includes('flickity-slider')) {
      $('.flickity-slider').each((_, slider) => {
        $(slider).removeAttr('style');
        $(slider).children().each((i, child) => {
          $(child).removeAttr('style').removeAttr('aria-hidden');
          if (i > 0) $(child).css('display', 'none');
        });
      });
      $('.flickity-viewport').css({ height: 'auto', overflow: 'hidden' });
    }

    await fse.writeFile(file, $.html(), 'utf8');
    fixed++;
  }

  console.log(`Done — updated ${fixed} files.`);
}

main().catch(err => { console.error(err); process.exit(1); });
