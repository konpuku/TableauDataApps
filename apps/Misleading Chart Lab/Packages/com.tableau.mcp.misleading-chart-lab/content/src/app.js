// ============================================================================
// Misleading Chart Lab(詐欺グラフ・ラボ)— 誤解を招くグラフの手口を、
// 正直なグラフと並べて体験するための教材 Data App。
//
// * サンプルデータは同梱 CSV(架空の数値)を queryAsync で取得する。
//   取得後はブラウザ内で自由に書き換えられる(Tableau 側には何も書き戻さない)。
// * 画面の状態はメモリ上だけ。Data App ではブラウザのストレージが使えない。
// ============================================================================
(function () {
  'use strict';
  var el = Kit.el;

  var SOURCE = 'Chart Samples';
  var FONTS = {
    sans: 'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", sans-serif',
    serif: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", Georgia, serif',
    round: '"Hiragino Maru Gothic ProN", "BIZ UDGothic", "Arial Rounded MT Bold", "Yu Gothic UI", sans-serif',
    mono: 'ui-monospace, "SF Mono", Consolas, "BIZ UDGothic", monospace',
    impact: 'Impact, "Arial Black", "Hiragino Kaku Gothic StdN", "Yu Gothic UI", sans-serif',
  };
  var FONT_LABEL = { sans: 'fontSans', serif: 'fontSerif', round: 'fontRound', mono: 'fontMono', impact: 'fontImpact' };
  var DEFAULT_STYLE = { main: '#2a78d6', accent: '#eb6834', bg: '#ffffff', ink: '#0b0b0b', fontKey: 'sans', size: 14 };
  // 手口の調整値は「描き方」(kind)ごとに持つ。
  var DEFAULT_PARAMS = {
    dual: { hideRight: true },
    truncate: { start: 82 },
    ratio: { inflate: 18 },
    interval: { even: true },
    bars3d: { perspective: 70 },
    pie3d: { tilt: 62, depth: 46, front: true, hideValues: true },
    category: { merge: 2 },
    cherry: { window: 6 },
    picto: { both: true },
    cumulative: { cumulative: true },
    multi: {},
    inverted: { invert: true },
  };
  var DEFAULT_VARIANT = { interval: 'ratio', threeD: 'bars3d' };

  var state = {
    lang: 'ja',
    pattern: 'dual',
    style: Object.assign({}, DEFAULT_STYLE),
    variant: Object.assign({}, DEFAULT_VARIANT), // 手口 3・4 で選んでいるグラフの種類
    params: JSON.parse(JSON.stringify(DEFAULT_PARAMS)),
    titles: {},   // 手口ごとに、利用者が書き換えた見出し(未編集なら既定の文言)
    data: null,   // 手口ごとの現在のデータ
    samples: null, // 取得したサンプル(「サンプルに戻す」用)
    sourceNote: null,
  };
  var ui = {};

  function t(key, vars) {
    var text = (window.I18N[state.lang] || {})[key];
    if (text == null) text = window.I18N.ja[key] != null ? window.I18N.ja[key] : key;
    return text.replace(/\{(\w+)\}/g, function (m, name) { return vars && vars[name] != null ? vars[name] : m; });
  }
  var loc = function (pair) { return pair[state.lang] != null ? pair[state.lang] : pair.ja; };
  /** いま選んでいる手口の「描き方」。手口 3・4 は種類の切り替えで変わる。 */
  var kindOf = function (pattern) { return Charts.VARIANTS[pattern] ? state.variant[pattern] : pattern; };

  // ---- データ -----------------------------------------------------------------
  function fetchSamples(ds) {
    return Kit.query(ds, [
      { fieldCaption: 'Pattern' },
      { fieldCaption: 'Series JA' }, { fieldCaption: 'Series EN' },
      { fieldCaption: 'Label JA' }, { fieldCaption: 'Label EN' },
      { fieldCaption: 'Position', function: 'MIN', fieldAlias: 'Pos' },
      { fieldCaption: 'Value', function: 'SUM', fieldAlias: 'Val' },
    ], [], 'samples').then(function (rows) {
      var by = Object.create(null);
      rows.forEach(function (r) {
        (by[r.Pattern] || (by[r.Pattern] = [])).push({
          series: { ja: String(r['Series JA']), en: String(r['Series EN']) },
          label: { ja: String(r['Label JA']), en: String(r['Label EN']) },
          pos: Kit.num(Kit.val(r, 'Pos', 'MIN(Position)')),
          value: Kit.num(Kit.val(r, 'Val', 'SUM(Value)')),
        });
      });
      var out = {};
      Charts.DATASETS.forEach(function (pattern) {
        var list = (by[pattern] || []).sort(function (a, b) { return a.pos - b.pos; });
        if (!list.length) throw new Error('サンプルデータに "' + pattern + '" の行がありません');
        if (pattern === 'dual') {
          var names = [], groups = {};
          list.forEach(function (row) {
            if (!groups[row.series.ja]) { groups[row.series.ja] = { name: row.series, rows: [] }; names.push(row.series.ja); }
            groups[row.series.ja].rows.push(row);
          });
          var series = names.map(function (n) { return groups[n]; }).sort(function (a, b) {
            return Math.max.apply(null, b.rows.map(function (r) { return r.value; })) -
              Math.max.apply(null, a.rows.map(function (r) { return r.value; }));
          });
          out.dual = {
            labels: series[0].rows.map(function (r) { return r.label; }),
            series: series.slice(0, 2).map(function (g) {
              return { name: g.name, values: g.rows.map(function (r) { return r.value; }) };
            }),
          };
        } else {
          out[pattern] = { items: list.map(function (r) { return { label: r.label, x: r.pos, value: r.value }; }) };
        }
      });
      return out;
    });
  }

  var clone = function (x) { return JSON.parse(JSON.stringify(x)); };

  /** 現在の言語に合わせた、描画用のデータ。 */
  function viewData(kind) {
    var d = state.data[kind];
    if (kind === 'dual') {
      return { labels: d.labels.map(loc), series: d.series.map(function (s) { return { name: loc(s.name), values: s.values }; }) };
    }
    var items = d.items.map(function (i) { return { label: loc(i.label), x: i.x, value: i.value }; });
    return kind === 'interval' ? { points: items } : { items: items };
  }

  function titleFor(kind, deceptive) {
    var custom = state.titles[kind + '.' + state.lang];
    if (deceptive && custom != null) return custom;
    return t('p_' + kind + (deceptive ? '_title' : '_honest'));
  }

  // ---- 描画 -------------------------------------------------------------------
  function renderCharts() {
    if (!state.data) return;
    var kind = kindOf(state.pattern);
    var style = Object.assign({}, state.style, { font: FONTS[state.style.fontKey] });
    var base = { data: viewData(kind), params: state.params[kind], style: style, t: t };
    var bad = Charts.render(kind, Object.assign({ deceptive: true, title: titleFor(kind, true) }, base));
    var good = Charts.render(kind, Object.assign({ deceptive: false, title: titleFor(kind, false) }, base));
    ui.bad.replaceChildren(bad.svg);
    ui.good.replaceChildren(good.svg);

    // 記事の「5 つのチェック」のうち、この手口に対応するもの(3D は 4 番目)
    var checkNo = Charts.ORDER.indexOf(state.pattern) + 1; // 追加の手口は 0(どれも強調しない)
    ui.explain.replaceChildren(
      block('howItWorks', t('p_' + kind + '_how')),
      block('measured', t('p_' + kind + '_measure', bad.measure), 'is-measure'),
      block('howToSpot', t('p_' + kind + '_spot')),
      block('howToFix', t('p_' + kind + '_fix')),
      el('div', { class: 'explain-block' }, [
        el('h3', { text: t('checklist') }),
        el('ol', { class: 'checks' }, [1, 2, 3, 4, 5].map(function (n) {
          return el('li', { class: n === checkNo ? 'is-current' : null, text: t('check' + n) });
        })),
      ]),
    );
  }

  function block(headingKey, text, cls) {
    return el('div', { class: 'explain-block ' + (cls || '') }, [
      el('h3', { text: t(headingKey) }), el('p', { text: text }),
    ]);
  }

  function range(labelKey, key, min, max, step, suffix, vars) {
    var params = state.params[kindOf(state.pattern)];
    var out = el('output', { text: params[key] + (suffix || '') });
    var input = el('input', { type: 'range', min: min, max: max, step: step, value: params[key] });
    input.addEventListener('input', function () {
      params[key] = Number(input.value);
      out.textContent = params[key] + (suffix || '');
      renderCharts();
    });
    return el('label', { class: 'field' }, [el('span', { text: t(labelKey, vars) }), input, out]);
  }

  function check(labelKey, key, vars) {
    var params = state.params[kindOf(state.pattern)];
    var input = el('input', { type: 'checkbox' });
    input.checked = !!params[key];
    input.addEventListener('change', function () { params[key] = input.checked; renderCharts(); });
    return el('label', { class: 'field is-check' }, [input, el('span', { text: t(labelKey, vars) })]);
  }

  function trickControls() {
    var pattern = state.pattern, kind = kindOf(pattern), d = state.data[kind], out = [];
    if (Charts.VARIANTS[pattern]) {
      out.push(el('div', { class: 'field is-stack' }, [
        el('span', { text: t('variant') }),
        el('div', { class: 'segmented', role: 'group', 'aria-label': t('variant') }, Charts.VARIANTS[pattern].map(function (v) {
          return el('button', {
            class: 'kit-btn', type: 'button', 'aria-pressed': String(v === kind), text: t('v_' + v),
            onclick: function () { state.variant[pattern] = v; renderAll(); },
          });
        })),
      ]));
    }
    if (kind === 'dual') out.push(check('dual_hideRight', 'hideRight'));
    if (kind === 'interval') out.push(check('interval_even', 'even'));
    if (kind === 'ratio') out.push(range('ratio_inflate', 'inflate', 0, 40, 1));
    if (kind === 'bars3d') out.push(range('bars3d_perspective', 'perspective', 0, 120, 5, '%'));
    if (kind === 'truncate') {
      var min = Math.min.apply(null, d.items.map(function (i) { return i.value; }));
      var max = Math.max(1, Math.floor(min - 0.1));
      state.params.truncate.start = Math.min(state.params.truncate.start, max);
      out.push(range('truncate_start', 'start', 0, max, 1));
    }
    if (kind === 'pie3d') {
      var own = { a: loc(d.items[0].label) };
      out.push(range('pie3d_tilt', 'tilt', 0, 75, 1, '°'), range('pie3d_depth', 'depth', 0, 70, 1),
        check('pie3d_front', 'front', own), check('pie3d_hideValues', 'hideValues'));
    }
    if (kind === 'category') out.push(range('category_merge', 'merge', 0, Math.floor(d.items.length / 2), 1));
    if (kind === 'cherry') out.push(range('cherry_window', 'window', 2, d.items.length, 1));
    if (kind === 'picto') out.push(check('picto_both', 'both'));
    if (kind === 'cumulative') out.push(check('cumulative_on', 'cumulative'));
    if (kind === 'inverted') out.push(check('inverted_on', 'invert'));
    return out;
  }

  function numberCell(get, set) {
    var input = el('input', { type: 'number', step: 'any', value: get(), class: 'cell-num' });
    input.addEventListener('input', function () {
      var v = Number(input.value);
      if (input.value === '' || !isFinite(v)) return;
      set(v);
      renderCharts();
    });
    return el('td', {}, input);
  }

  function labelCell(pair) {
    var input = el('input', { type: 'text', value: loc(pair), class: 'cell-text' });
    input.addEventListener('input', function () { pair[state.lang] = input.value; renderCharts(); });
    return el('td', {}, input);
  }

  function dataEditor() {
    var kind = kindOf(state.pattern), d = state.data[kind], head, rows;
    if (kind === 'dual') {
      head = [t('label')].concat(d.series.map(function (s) { return loc(s.name); }));
      rows = d.labels.map(function (label, i) {
        return el('tr', {}, [labelCell(label)].concat(d.series.map(function (s) {
          return numberCell(function () { return s.values[i]; }, function (v) { s.values[i] = v; });
        })));
      });
    } else {
      head = [t('label'), t('value')];
      rows = d.items.map(function (item) {
        return el('tr', {}, [labelCell(item.label),
          numberCell(function () { return item.value; }, function (v) { item.value = v; })]);
      });
    }
    return el('table', { class: 'data-table' }, [
      el('thead', {}, el('tr', {}, head.map(function (h) { return el('th', { text: h }); }))),
      el('tbody', {}, rows),
    ]);
  }

  function colorField(labelKey, key) {
    var input = el('input', { type: 'color', value: state.style[key] });
    input.addEventListener('input', function () { state.style[key] = input.value; renderCharts(); });
    return el('label', { class: 'field is-color' }, [el('span', { text: t(labelKey) }), input]);
  }

  /** 言語・手口が変わったとき、画面全体を組み立て直す。 */
  function renderAll() {
    document.documentElement.lang = state.lang;
    var ready = !!state.data;

    var langButtons = ['ja', 'en'].map(function (code) {
      return el('button', {
        class: 'kit-btn', type: 'button', 'aria-pressed': String(state.lang === code),
        text: code === 'ja' ? '日本語' : 'English',
        onclick: function () { state.lang = code; renderAll(); },
      });
    });

    var patternButton = function (id, no) {
      return el('button', {
        class: 'pattern', type: 'button', 'aria-pressed': String(state.pattern === id),
        onclick: function () { state.pattern = id; renderAll(); },
      }, [el('span', { class: 'pattern-no', text: String(no) }), el('span', { text: t('n_' + id) })]);
    };
    var articleButtons = Charts.ORDER.map(function (id, i) { return patternButton(id, i + 1); });
    var extraButtons = Charts.EXTRA.map(function (id, i) { return patternButton(id, Charts.ORDER.length + i + 1); });

    var fontSelect = el('select', {}, Object.keys(FONTS).map(function (key) {
      return el('option', { value: key, text: t(FONT_LABEL[key]) });
    }));
    fontSelect.value = state.style.fontKey;
    fontSelect.addEventListener('change', function () { state.style.fontKey = fontSelect.value; renderCharts(); });
    var sizeOut = el('output', { text: state.style.size + 'px' });
    var size = el('input', { type: 'range', min: 11, max: 20, step: 1, value: state.style.size });
    size.addEventListener('input', function () {
      state.style.size = Number(size.value); sizeOut.textContent = state.style.size + 'px'; renderCharts();
    });

    ui.bad = el('div', { class: 'chart' });
    ui.good = el('div', { class: 'chart' });
    ui.explain = el('div', { class: 'explain' });

    var titleInput = el('input', { type: 'text', class: 'title-input', value: ready ? titleFor(kindOf(state.pattern), true) : '' });
    titleInput.addEventListener('input', function () {
      state.titles[kindOf(state.pattern) + '.' + state.lang] = titleInput.value; renderCharts();
    });

    var main = ready ? [
      el('div', { class: 'charts' }, [
        el('section', { class: 'kit-card chart-card' }, [
          el('div', { class: 'tag is-bad', text: '✕ ' + t('misleading') }), ui.bad,
        ]),
        el('section', { class: 'kit-card chart-card' }, [
          el('div', { class: 'tag is-good', text: '✓ ' + t('honest') }), ui.good,
        ]),
      ]),
      el('div', { class: 'lower' }, [
        el('section', { class: 'kit-card' }, ui.explain),
        el('section', { class: 'kit-card' }, [
          el('h2', { text: t('trick') }),
          el('label', { class: 'field is-stack' }, [el('span', { text: t('chartTitle') }), titleInput]),
        ].concat(trickControls(), [
          el('h2', { class: 'sep' }, [t('data'), el('small', { text: t('dataNote') })]),
          el('div', { class: 'data-scroll' }, dataEditor()),
          el('button', {
            class: 'kit-btn', type: 'button', text: t('resetData'),
            onclick: function () {
              var kind = kindOf(state.pattern);
              state.data[kind] = clone(state.samples[kind]);
              state.params[kind] = clone(DEFAULT_PARAMS[kind]);
              delete state.titles[kind + '.' + state.lang];
              renderAll();
            },
          }),
        ])),
      ]),
    ] : [el('section', { class: 'kit-card' }, el('p', { class: 'kit-empty', text: t(state.sourceNote ? 'loading' : 'connecting') }))];

    var note = state.sourceNote
      ? (state.sourceNote.fallback ? t('sourceFallback', { reason: state.sourceNote.reason }) : t('sourceLive'))
      : t('connecting');

    document.getElementById('app').replaceChildren(el('div', { class: 'layout kit-mounted' }, [
      el('header', { class: 'top' }, [
        el('div', {}, [el('h1', { text: t('appTitle') }), el('p', { class: 'sub', text: t('appSub') })]),
        el('div', { class: 'lang', role: 'group', 'aria-label': t('language') }, langButtons),
      ]),
      el('div', { class: 'body' }, [
        el('aside', { class: 'side' }, [
          el('section', { class: 'kit-card' }, [
            el('h2', { text: t('patterns') }),
            el('div', { class: 'group-label', text: t('groupArticle') }),
            el('div', { class: 'patterns' }, articleButtons),
            el('div', { class: 'group-label', text: t('groupExtra') }),
            el('div', { class: 'patterns' }, extraButtons),
          ]),
          el('section', { class: 'kit-card' }, [
            el('h2', { text: t('style') }),
            colorField('mainColor', 'main'), colorField('accentColor', 'accent'),
            colorField('bgColor', 'bg'), colorField('inkColor', 'ink'),
            el('label', { class: 'field is-stack' }, [el('span', { text: t('font') }), fontSelect]),
            el('label', { class: 'field' }, [el('span', { text: t('fontSize') }), size, sizeOut]),
            el('p', { class: 'hint', text: t('fontNote') }),
            el('button', {
              class: 'kit-btn', type: 'button', text: t('resetStyle'),
              onclick: function () { state.style = Object.assign({}, DEFAULT_STYLE); renderAll(); },
            }),
          ]),
        ]),
        el('main', { class: 'main' }, main),
      ]),
      el('footer', { class: 'kit-foot' }, [el('div', { text: t('credit') }), el('div', { text: note }), el('div', { text: t('capture') })]),
    ]));
    renderCharts();
  }

  renderAll();
  Kit.boot(function (ctx) {
    var ds = Kit.requireSource(ctx, SOURCE);
    // 架空の数値だけの小さな表なので、queryAsync が使えないときは従来 API で読む。
    Kit.enableLocalFallback(ds);
    state.sourceNote = {};
    renderAll();
    return fetchSamples(ds).then(function (samples) {
      state.samples = samples;
      state.data = clone(samples);
      state.sourceNote = { fallback: Kit.stats.fallbackQueries > 0, reason: Kit.stats.fallbackReason };
      renderAll();
    });
  });
})();
