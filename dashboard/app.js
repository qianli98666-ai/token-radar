// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table, a per-protocol detail drawer with the model's own inputs and
// the protocol's farm plan, and a model sandbox that re-ranks the board live. No network: every byte
// it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var sandbox = { bench: 1, growth: DATA.model.growth_weight, maturity: DATA.model.maturity_range };
  var sandboxTouched = false;

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (Math.round(n * 100) / 100).toFixed(2) + 'x'; }

  // The model in one function, as the page runs it: the same arithmetic board.json carries, with the
  // sandbox's three dials applied. At their defaults it returns the board's own number, so the page's
  // code and the board's data are visibly the same model.
  function impliedOf(row, m) {
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    // Rounded to 4 decimals exactly as the model rounds them, so at the sandbox's defaults this
    // returns the board's own number, and the detail view can say so honestly.
    var growthMult = Math.round((1 + (growth / 100) * sandbox.growth) * 1e4) / 1e4;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = Math.round((m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * sandbox.maturity) * 1e4) / 1e4;
    return Math.max(1, Math.round(row.tvl_usd * row.benchmark * sandbox.bench * growthMult * maturity));
  }
  function effectiveRows() {
    return DATA.rows.map(function (r) {
      var copy = Object.assign({}, r);
      copy.effective = impliedOf(r, DATA.model);
      return copy;
    });
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the one main.ts writes to board.json: the page shows the same strings the
  // board carries, so the screenshots and the board can never disagree. Each step is one sentence
  // of action followed by its cost and time.
  function whyText(r) {
    var tvl = r.tvl_usd >= 1e9 ? '$' + (r.tvl_usd / 1e9).toFixed(2) + 'B' : '$' + Math.round(r.tvl_usd / 1e6) + 'M';
    var growth = r.change_7d === null ? 'no weekly change reported' : (r.change_7d >= 0 ? 'growing ' : 'shrinking ') + Math.abs(r.change_7d).toFixed(1) + '% this week';
    var age = r.age_days === null ? 'with no listing date on record' : 'listed ' + r.age_days + ' days ago';
    var priced = r.benchmark_category === 'all live tokens'
      ? 'Priced at ' + fmtMult(r.benchmark) + ' of TVL like live tokens overall (' + r.benchmark_n + ' of them).'
      : 'Priced at ' + fmtMult(r.benchmark) + ' of TVL like the live ' + r.benchmark_category + ' tokens (' + r.benchmark_n + ' of them).';
    return tvl + ' of TVL, ' + growth + ', ' + age + ', and no token on record. ' + priced;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return effectiveRows().filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (state.watchOnly && !r.watch) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.effective; bv = b.effective; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, every one of them ranked. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function topPick() {
    var top = DATA.rows[0];
    if (!top) return null;
    var steps = top.farm_steps || [];
    var firstMove = steps.length > 1 ? steps[1].split(' Cost: ')[0] : '';
    return el('section', { class: 'pick' },
      el('div', null,
        el('span', { class: 'kick', text: 'Farm this one first' }),
        el('h2', null, 'Rank 1 · ', el('b', { text: top.name })),
        el('p', { text: whyText(top) }),
        el('p', { text: 'First move: ' + firstMove }),
        el('button', { class: 'button light', type: 'button', text: 'Open the full farm plan', onclick: function () { openDetail(top.slug); } })
      ),
      el('div', { class: 'pick-num' },
        el('span', { text: 'Implied value' }),
        el('b', { text: fmtUsd(top.implied_value_usd) }),
        el('span', { text: 'TVL ' + fmtUsd(top.tvl_usd) + ' · 7d ' + fmtPct(top.change_7d) })
      )
    );
  }

  function topTen() {
    var list = DATA.rows.slice(0, 10);
    var max = list[0].implied_value_usd || 1;
    return el('section', { class: 'topten' },
      el('h2', { text: 'Top ten by implied value' }),
      list.map(function (r) {
        return el('button', { type: 'button', class: 'bar-row', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'rank', text: String(r.rank) }),
          el('b', { text: r.name }),
          el('span', { class: 'track' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) })
        );
      })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderTable(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); renderTable(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; renderTable(); });
    var tvlSelect = el('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      el('option', { value: '0', text: 'Any TVL' }),
      el('option', { value: '50000000', text: 'TVL $50M+' }),
      el('option', { value: '100000000', text: 'TVL $100M+' }),
      el('option', { value: '500000000', text: 'TVL $500M+' })
    );
    tvlSelect.addEventListener('change', function () { state.minTvl = Number(tvlSelect.value); renderTable(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watchOnly', checked: state.watchOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    watchBox.addEventListener('change', function () { state.watchOnly = watchBox.checked; renderTable(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; buildShell(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; buildShell(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'TVL' }), tvlSelect),
      el('label', { class: 'check', for: 'watchOnly' }, watchBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', id: 'rowCount', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } renderTable(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchOnly = false; writeHash(); buildShell(); } })
      ));
    }
    var max = list[0].effective || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var rankCell = r.rank <= 3
        ? el('td', { class: 'num' }, el('span', { class: 'medal', text: String(r.rank) }))
        : el('td', { class: 'num', text: String(r.rank) });
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        rankCell,
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.effective / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.effective) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' + (sandboxTouched ? ' Sandbox model active: values below follow the dials, board.json keeps radar-2.' : '') }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. Their market-cap/TVL ratios are the benchmarks the pre-token board is priced against.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var benchRows = DATA.benchmarks.by_category.slice(0, 8).map(function (b) {
      return el('tr', null,
        el('td', { text: b.category }),
        el('td', { class: 'num', text: String(b.live_n) }),
        el('td', { class: 'num', text: fmtMult(b.median) })
      );
    });
    var slider = function (id, label, min, max, step, value, fmt, oninput) {
      var out = el('output', { id: id + '-out', text: fmt(value) });
      var range = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      range.addEventListener('input', function () { var v = Number(range.value); out.textContent = fmt(v); oninput(v); });
      return el('label', { for: id }, label, range, out);
    };
    var benchSlider = slider('sb-bench', 'Benchmark scale', 0.5, 2, 0.05, sandbox.bench, fmtMult, function (v) { sandbox.bench = v; sandboxTouched = true; renderTable(); });
    var growthSlider = slider('sb-growth', 'Growth weight', 0, 1, 0.05, sandbox.growth, String, function (v) { sandbox.growth = v; sandboxTouched = true; renderTable(); });
    var maturitySlider = slider('sb-maturity', 'Maturity range', 0, 0.8, 0.05, sandbox.maturity, String, function (v) { sandbox.maturity = v; sandboxTouched = true; renderTable(); });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x benchmark x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('p', { class: 'sub', text: 'The benchmark is the median live market-cap/TVL of the protocol\'s own category (at least ' + m.bench_min_n + ' live tokens, else the global median ' + fmtMult(DATA.benchmarks.global_median) + ' over ' + DATA.benchmarks.live_n + ' live tokens), clamped to [' + m.bench_floor + ', ' + m.bench_cap + ']. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days.' }),
      el('h3', { text: 'What the market pays for a dollar of TVL' }),
      el('table', { class: 'bench' },
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live tokens' }), el('th', { scope: 'col', text: 'Median mcap/TVL' }))),
        el('tbody', null, benchRows,
          el('tr', null, el('td', { text: 'All live tokens (fallback)' }), el('td', { class: 'num', text: String(DATA.benchmarks.live_n) }), el('td', { class: 'num', text: fmtMult(DATA.benchmarks.global_median) })))
      ),
      el('h3', { text: 'Model sandbox' }),
      el('div', { class: 'sandbox' }, benchSlider, growthSlider, maturitySlider),
      el('p', { class: 'sandbox-note', id: 'sandboxNote', text: sandboxTouched ? 'Sandbox active: the board above re-ranks on these dials. board.json keeps the radar-2 values.' : 'Move a dial to re-rank the board on the spot. The sandbox changes only this page: board.json keeps the radar-2 values.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = row.farm_steps || [];
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Why it ranks here' }),
      el('p', { class: 'sub', text: whyText(row) })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Benchmark (' + row.benchmark_category + ', n=' + row.benchmark_n + ')' }), el('b', { class: 'num', text: fmtMult(row.benchmark) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the sandbox dials are moved.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { class: 'risk', text: 'No token, no points and no airdrop are promised. Points programs change without notice, and a claim that asks for payment is a scam: never pay to claim.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // The shell is built once (or on a tab switch, which is a click); filters, sorting and the
  // sandbox only replace the table, so typing in the search box or dragging a slider never loses
  // focus. buildShell also opens the detail drawer when the URL hash names a protocol.
  var tableHost = null;

  function renderTable() {
    if (!tableHost) return;
    tableHost.textContent = '';
    tableHost.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    var count = document.getElementById('rowCount');
    if (count) count.textContent = state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols';
    var note = document.getElementById('sandboxNote');
    if (note) note.textContent = sandboxTouched ? 'Sandbox active: the board above re-ranks on these dials. board.json keeps the radar-2 values.' : 'Move a dial to re-rank the board on the spot. The sandbox changes only this page: board.json keeps the radar-2 values.';
  }

  function buildShell() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    if (state.tab === 'pre-token') shell.appendChild(topPick());
    if (state.tab === 'pre-token') shell.appendChild(topTen());
    shell.appendChild(controls());
    tableHost = el('div', { id: 'boardTable' });
    shell.appendChild(tableHost);
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    renderTable();
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  buildShell();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
