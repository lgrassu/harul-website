/* Sermon notes page.
   Reads sermons/<date>.json, written by the Apps Script from the Credo email.
   URL: predica.html?d=2026-11-01

   site.js keeps its language in a private variable, so rather than reach into
   it we follow <html lang>, which site.js sets whenever the toggle changes. */
(function () {
  'use strict';

  var STR = {
    ro: {
      missing: 'Nu am găsit rezumatul pentru această dată.',
      badLink: 'Link incomplet — lipsește data predicii.'
    },
    en: {
      missing: 'No summary found for this date.',
      badLink: 'Incomplete link — the sermon date is missing.'
    }
  };

  var MONTHS = {
    ro: ['ianuarie','februarie','martie','aprilie','mai','iunie',
         'iulie','august','septembrie','octombrie','noiembrie','decembrie'],
    en: ['January','February','March','April','May','June',
         'July','August','September','October','November','December']
  };

  var data = null;
  var el = function (id) { return document.getElementById(id); };
  var lang = function () {
    return document.documentElement.lang === 'en' ? 'en' : 'ro';
  };

  function dateParam() {
    var m = location.search.match(/[?&]d=(\d{4}-\d{2}-\d{2})\b/);
    return m ? m[1] : null;
  }

  function formatDate(iso, L) {
    var p = iso.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var month = MONTHS[L][d.getMonth()];
    return L === 'en'
      ? month + ' ' + d.getDate() + ', ' + d.getFullYear()
      : d.getDate() + ' ' + month + ' ' + d.getFullYear();
  }

  function showMissing(message) {
    el('pred-body').hidden = true;
    el('pred-draft').hidden = true;
    var box = el('pred-missing');
    box.hidden = false;
    if (message) box.querySelector('p').textContent = message;
    el('pred-title').textContent = '—';
  }

  function render() {
    if (!data) return;
    var L = lang();
    var side = data[L] || data.ro || data.en;
    if (!side) { showMissing(STR[L].missing); return; }

    el('pred-title').textContent = side.title || '';
    el('pred-date').textContent = data.service_date
      ? formatDate(data.service_date, L) : '';

    // Credo sends the Bible passage only when the sermon has one.
    var passage = side.passage || data.passage || '';
    var pEl = el('pred-passage');
    pEl.textContent = passage;
    pEl.hidden = !passage;

    setBlock('pred-theme', 'pred-theme-block', side.theme);
    setBlock('pred-summary', 'pred-summary-block', side.summary);
    setBlock('pred-apply', 'pred-apply-block', side.application);

    var ol = el('pred-points');
    ol.innerHTML = '';
    var pts = side.points || [];
    pts.forEach(function (p) {
      var li = document.createElement('li');
      if (p.heading) {
        var h = document.createElement('strong');
        h.textContent = p.heading;
        li.appendChild(h);
        li.appendChild(document.createTextNode(' '));
      }
      li.appendChild(document.createTextNode(p.body || ''));
      ol.appendChild(li);
    });
    el('pred-points-block').hidden = pts.length === 0;

    var ul = el('pred-verses');
    ul.innerHTML = '';
    var vs = side.key_verses || [];
    vs.forEach(function (v) {
      var li = document.createElement('li');
      li.textContent = v;
      ul.appendChild(li);
    });
    el('pred-verses-block').hidden = vs.length === 0;

    // Absent "published" counts as a draft. A published note that loses the
    // field just shows a banner; a draft that loses it must not go public.
    el('pred-draft').hidden = data.published === true;
    el('pred-missing').hidden = true;
    el('pred-body').hidden = false;

    document.title = (side.title || 'Rezumatul predicii') +
                     ' — Biserica Baptistă Harul';
  }

  function setBlock(textId, blockId, value) {
    var has = !!(value && String(value).trim());
    el(textId).textContent = has ? value : '';
    el(blockId).hidden = !has;
  }

  function load() {
    var d = dateParam();
    if (!d) { showMissing(STR[lang()].badLink); return; }

    fetch('sermons/' + d + '.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('not found');
        return r.json();
      })
      .then(function (json) { data = json; render(); })
      .catch(function () { showMissing(STR[lang()].missing); });
  }

  // Re-render when site.js switches language.
  new MutationObserver(function () { render(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
