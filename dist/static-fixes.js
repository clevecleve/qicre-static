/* =====================================================================
   static-fixes.js — QIC RE static site runtime patches
   ===================================================================== */
(function () {
  'use strict';

  /* ================================================================
     1. CAROUSEL — add prev / next buttons + dot indicators
     ================================================================ */
  function initCarousels() {
    document.querySelectorAll('.flickity-viewport').forEach(function (viewport) {
      var slider = viewport.querySelector('.flickity-slider');
      if (!slider) return;

      var cells = Array.from(slider.children).filter(function (c) {
        return c.nodeType === 1;
      });
      if (cells.length <= 1) return;

      var current = 0;

      // Wrap the viewport in a relative container so buttons can be positioned
      var wrap = document.createElement('div');
      wrap.className = 'sf-carousel-wrap';
      viewport.parentNode.insertBefore(wrap, viewport);
      wrap.appendChild(viewport);

      function showSlide(n) {
        cells[current].style.display = 'none';
        current = ((n % cells.length) + cells.length) % cells.length;
        cells[current].style.display = '';
        dots.forEach(function (d, i) {
          d.classList.toggle('active', i === current);
        });
      }

      // Prev button
      var prevBtn = document.createElement('button');
      prevBtn.className = 'sf-carousel-btn sf-carousel-prev';
      prevBtn.setAttribute('aria-label', 'Previous slide');
      prevBtn.innerHTML = '&#8249;';
      prevBtn.addEventListener('click', function () { showSlide(current - 1); });
      wrap.appendChild(prevBtn);

      // Next button
      var nextBtn = document.createElement('button');
      nextBtn.className = 'sf-carousel-btn sf-carousel-next';
      nextBtn.setAttribute('aria-label', 'Next slide');
      nextBtn.innerHTML = '&#8250;';
      nextBtn.addEventListener('click', function () { showSlide(current + 1); });
      wrap.appendChild(nextBtn);

      // Dot indicators
      var dotsWrap = document.createElement('div');
      dotsWrap.className = 'sf-carousel-dots';
      var dots = cells.map(function (_, i) {
        var dot = document.createElement('button');
        dot.className = 'sf-carousel-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', 'Go to slide ' + (i + 1));
        dot.addEventListener('click', function () { showSlide(i); });
        dotsWrap.appendChild(dot);
        return dot;
      });
      wrap.parentNode.insertBefore(dotsWrap, wrap.nextSibling);

      // Touch / swipe support
      var touchStartX = null;
      viewport.addEventListener('touchstart', function (e) {
        touchStartX = e.touches[0].clientX;
      }, { passive: true });
      viewport.addEventListener('touchend', function (e) {
        if (touchStartX === null) return;
        var dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 40) showSlide(dx < 0 ? current + 1 : current - 1);
        touchStartX = null;
      }, { passive: true });
    });
  }

  /* ================================================================
     2. PROPERTIES PAGE — wire existing checkboxes to tile visibility
     ================================================================ */
  function initPropertiesFilter() {
    var tiles = Array.from(document.querySelectorAll('.tile-range'));
    if (!tiles.length) return;

    var filterContainers = Array.from(document.querySelectorAll('.filter-items'));
    if (!filterContainers.length) return;

    // Stamp each tile with data-sf-type and data-sf-state from its address text
    tiles.forEach(function (tile) {
      var addr = tile.querySelector('.address');
      if (!addr) return;
      var text = addr.textContent.trim();
      var pipe = text.indexOf('|');
      var type  = pipe > -1 ? text.slice(0, pipe).trim() : '';
      var loc   = pipe > -1 ? text.slice(pipe + 1).trim() : '';
      var comma = loc.lastIndexOf(',');
      var state = comma > -1 ? loc.slice(comma + 1).trim() : '';
      tile.dataset.sfType  = type;
      tile.dataset.sfState = state;
    });

    // Identify type vs state filter containers by their checkbox values
    var typeContainer  = null;
    var stateContainer = null;
    filterContainers.forEach(function (fc) {
      var vals = Array.from(fc.querySelectorAll('input[type="checkbox"]'))
                      .map(function (cb) { return cb.value; });
      if (vals.some(function (v) { return ['Retail','Office','Hotel','Civic'].includes(v); })) {
        typeContainer = fc;
      } else if (vals.some(function (v) { return ['ACT','NSW','QLD','VIC'].includes(v); })) {
        stateContainer = fc;
      }
    });

    function getChecked(container) {
      if (!container) return [];
      return Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
                  .map(function (cb) { return cb.value; });
    }

    function applyFilter() {
      var types  = getChecked(typeContainer);
      var states = getChecked(stateContainer);
      var allTypes  = !types.length  || types.includes('All');
      var allStates = !states.length || states.includes('All');

      tiles.forEach(function (tile) {
        var t   = tile.dataset.sfType  || '';
        var s   = tile.dataset.sfState || '';
        var col = tile.closest('[class*="col-"]') || tile;
        var show = (allTypes  || types.includes(t))
                && (allStates || states.includes(s));
        col.style.display = show ? '' : 'none';
      });
    }

    // Handle the "All" toggle within each container
    [typeContainer, stateContainer].forEach(function (fc) {
      if (!fc) return;
      var allCb   = fc.querySelector('input[value="All"]');
      var others  = Array.from(fc.querySelectorAll('input[type="checkbox"]'))
                        .filter(function (cb) { return cb.value !== 'All'; });

      if (allCb) {
        allCb.addEventListener('change', function () {
          if (this.checked) others.forEach(function (cb) { cb.checked = false; });
          applyFilter();
        });
      }
      others.forEach(function (cb) {
        cb.addEventListener('change', function () {
          if (allCb && this.checked) allCb.checked = false;
          applyFilter();
        });
      });
    });
  }

  /* ================================================================
     3. NEWS PAGE — inject a simple category filter bar
     ================================================================ */
  function initNewsFilter() {
    // Only act when news tiles are present AND no server-driven filter exists
    var tiles = Array.from(document.querySelectorAll('.tile-range'));
    if (!tiles.length) return;

    // Must have at least one .tags element to know we're on a news listing
    var hasTags = tiles.some(function (t) { return t.querySelector('.tags'); });
    if (!hasTags) return;

    // Collect distinct categories from visible tile tags
    var categoryOrder = [];
    var seen = new Set();
    tiles.forEach(function (tile) {
      var tag = tile.querySelector('.tags');
      if (!tag) return;
      var cat = tag.textContent.trim();
      if (cat && !seen.has(cat)) { seen.add(cat); categoryOrder.push(cat); }
    });
    if (!categoryOrder.length) return;

    // Build the filter bar
    var bar = document.createElement('div');
    bar.className = 'sf-news-filter container';

    function makeBtn(label, active) {
      var btn = document.createElement('button');
      btn.className = 'sf-filter-btn' + (active ? ' active' : '');
      btn.textContent = label;
      btn.dataset.cat = label;
      return btn;
    }

    var allBtn = makeBtn('All', true);
    bar.appendChild(allBtn);
    categoryOrder.forEach(function (cat) { bar.appendChild(makeBtn(cat, false)); });

    // Insert bar before the first row that contains tiles
    var firstRow = null;
    tiles.forEach(function (tile) {
      var row = tile.closest('.row');
      if (row && (!firstRow || row.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        firstRow = row;
      }
    });
    if (firstRow) {
      firstRow.parentNode.insertBefore(bar, firstRow);
    }

    function applyNewsFilter(selected) {
      bar.querySelectorAll('.sf-filter-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.cat === selected);
      });
      tiles.forEach(function (tile) {
        var tag = tile.querySelector('.tags');
        var cat = tag ? tag.textContent.trim() : '';
        var col = tile.closest('[class*="col-"]') || tile;
        col.style.display = (selected === 'All' || cat === selected) ? '' : 'none';
      });
    }

    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('.sf-filter-btn');
      if (btn) applyNewsFilter(btn.dataset.cat);
    });
  }

  /* ================================================================
     4. CONTACT FORM — graceful fallback notice + intercept submit
     ================================================================ */
  function initContactForm() {
    var form = document.querySelector('form[novalidate]');
    if (!form) return;

    // Add a notice above the form
    var notice = document.createElement('div');
    notice.className = 'sf-form-notice';
    notice.innerHTML = 'You can also reach us directly at '
      + '<a href="mailto:enquiries@qicre.com">enquiries@qicre.com</a>. '
      + 'Our team will get back to you promptly.';
    form.parentNode.insertBefore(notice, form);

    // Intercept submit and replace form with a confirmation
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fallback = document.createElement('div');
      fallback.className = 'sf-contact-fallback';
      fallback.innerHTML = '<h3>Thank you for getting in touch</h3>'
        + '<p>Our contact form is temporarily unavailable. '
        + 'Please email us directly at '
        + '<a href="mailto:enquiries@qicre.com">enquiries@qicre.com</a> '
        + 'and a member of our team will respond shortly.</p>';
      form.parentNode.replaceChild(fallback, form);
    });
  }

  /* ================================================================
     5. SEARCH PAGE — replace or augment with a static notice
     ================================================================ */
  function initSearchPage() {
    if (window.location.pathname.toLowerCase().indexOf('/search') === -1) return;

    // Find the main content area
    var main = document.querySelector('.container main, main, [role="main"], #root > div > div:nth-child(2)');

    // Try to find the search input wrapper to insert notice after it
    var searchInput = document.querySelector('input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]');
    var insertTarget = searchInput
      ? (searchInput.closest('.container') || searchInput.parentNode)
      : (main || document.querySelector('.container'));

    if (!insertTarget) return;

    var notice = document.createElement('div');
    notice.className = 'sf-search-notice';
    notice.innerHTML = '<h2>Search</h2>'
      + '<p>Full-text search is not available in this version of the site. '
      + 'Use the links below to browse our content, or navigate using the menu above.</p>'
      + '<div class="sf-browse-links">'
      + '<a href="/Properties">Browse Properties</a>'
      + '<a href="/News">Browse News</a>'
      + '<a href="/ESG/ESG-overview">ESG Reports</a>'
      + '<a href="/Brand_iQ">Brand iQ</a>'
      + '<a href="/Contact-Us">Contact Us</a>'
      + '</div>';

    // Insert after the search input or at the start of main
    if (searchInput) {
      var wrap = searchInput.closest('.container') || searchInput.parentNode;
      wrap.parentNode.insertBefore(notice, wrap.nextSibling);
    } else {
      insertTarget.insertBefore(notice, insertTarget.firstChild);
    }
  }

  /* ================================================================
     6. NAV — ensure desktop dropdown menus open on click (fallback)
     ================================================================ */
  function initNavDropdowns() {
    document.querySelectorAll('.nav-item').forEach(function (item) {
      var wrapper = item.querySelector('.nav-link-wrapper');
      var sub     = item.querySelector('.navbar-nav-items');
      if (!wrapper || !sub) return;

      wrapper.style.cursor = 'pointer';
      wrapper.addEventListener('click', function (e) {
        var isOpen = sub.classList.contains('sf-open');
        // Close all others
        document.querySelectorAll('.navbar-nav-items.sf-open').forEach(function (s) {
          s.classList.remove('sf-open');
          s.style.display = '';
        });
        if (!isOpen) {
          sub.classList.add('sf-open');
          sub.style.display = 'block';
          e.stopPropagation();
        }
      });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', function () {
      document.querySelectorAll('.navbar-nav-items.sf-open').forEach(function (s) {
        s.classList.remove('sf-open');
        s.style.display = '';
      });
    });
  }

  /* ================================================================
     Boot
     ================================================================ */
  function boot() {
    initCarousels();
    initPropertiesFilter();
    initNewsFilter();
    initContactForm();
    initSearchPage();
    initNavDropdowns();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
