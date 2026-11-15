// ============================================================================
// Globe Explorer — 同梱 CSV(USGS の地震 1 週間分)を queryAsync でライブ集計し、
// Canvas の地球儀に描く Data App。
//
// 画面の操作(最小マグニチュード / 種別 / 地域)はすべて VDS のフィルターになり、
// 変えるたびにクエリを投げ直す。データをコードに焼き込まない。
// ============================================================================
(function () {
  'use strict';
  var el = Kit.el, num = Kit.num, val = Kit.val;

  var SOURCE = 'Earthquakes'; // .twb に配線したデータソースの caption
  var state = { minMag: 2.5, type: 'earthquake', area: null };
  var ui = {};
  var globe = null;
  var ds = null;
  var tip = null;
  var requestId = 0;

  // ---- フィルター(画面の状態 → VDS) ---------------------------------------
  function filters(opts) {
    var list = [{
      field: { fieldCaption: 'Magnitude' },
      filterType: 'QUANTITATIVE_NUMERICAL',
      quantitativeFilterType: 'MIN',
      min: state.minMag,
    }];
    if (state.type) {
      list.push({ field: { fieldCaption: 'Event Type' }, filterType: 'SET', values: [state.type] });
    }
    if (state.area && !(opts && opts.ignoreArea)) {
      list.push({ field: { fieldCaption: 'Area' }, filterType: 'SET', values: [state.area] });
    }
    return list;
  }

  // ---- クエリ ----------------------------------------------------------------
  // 緯度経度はメジャー扱いなので、Event ID で 1 行 1 地震に束ねて集計関数で取り出す。
  function fetchPoints() {
    return Kit.query(ds, [
      { fieldCaption: 'Event ID' },
      { fieldCaption: 'Place' },
      { fieldCaption: 'Area' },
      { fieldCaption: 'Time', function: 'MAX', fieldAlias: 'When' },
      { fieldCaption: 'Magnitude', function: 'MAX', fieldAlias: 'Mag' },
      { fieldCaption: 'Depth Km', function: 'MAX', fieldAlias: 'Depth' },
      { fieldCaption: 'Latitude', function: 'AVG', fieldAlias: 'Lat' },
      { fieldCaption: 'Longitude', function: 'AVG', fieldAlias: 'Lon' },
    ], filters(), 'points').then(function (rows) {
      return rows.map(function (r) {
        return {
          id: r['Event ID'],
          place: r.Place || '(場所不明)',
          area: r.Area,
          when: val(r, 'When', 'MAX(Time)'),
          mag: num(val(r, 'Mag', 'MAX(Magnitude)')),
          depth: num(val(r, 'Depth', 'MAX(Depth Km)')),
          lat: num(val(r, 'Lat', 'AVG(Latitude)')),
          lon: num(val(r, 'Lon', 'AVG(Longitude)')),
        };
      });
    });
  }

  function fetchKpis() {
    return Kit.query(ds, [
      { fieldCaption: 'Event ID', function: 'COUNT', fieldAlias: 'Events' },
      { fieldCaption: 'Magnitude', function: 'MAX', fieldAlias: 'MaxMag' },
      { fieldCaption: 'Depth Km', function: 'AVG', fieldAlias: 'AvgDepth' },
      { fieldCaption: 'Area', function: 'COUNTD', fieldAlias: 'Areas' },
    ], filters(), 'kpis').then(function (rows) {
      var r = rows[0] || {};
      return {
        events: num(val(r, 'Events', 'COUNT(Event ID)')),
        maxMag: num(val(r, 'MaxMag', 'MAX(Magnitude)')),
        avgDepth: num(val(r, 'AvgDepth', 'AVG(Depth Km)')),
        areas: num(val(r, 'Areas', 'COUNTD(Area)')),
      };
    });
  }

  // 地域ランキングは「地域」での絞り込みを外して数える(選んだ地域だけにならないように)。
  function fetchAreas() {
    return Kit.query(ds, [
      { fieldCaption: 'Area' },
      { fieldCaption: 'Event ID', function: 'COUNT', fieldAlias: 'Events' },
      { fieldCaption: 'Magnitude', function: 'MAX', fieldAlias: 'MaxMag' },
    ], filters({ ignoreArea: true }), 'areas').then(function (rows) {
      return rows.map(function (r) {
        return {
          area: r.Area,
          events: num(val(r, 'Events', 'COUNT(Event ID)')),
          maxMag: num(val(r, 'MaxMag', 'MAX(Magnitude)')),
        };
      }).filter(function (a) { return a.area != null; })
        .sort(function (a, b) { return b.events - a.events; });
    });
  }

  function fetchDaily() {
    return Kit.query(ds, [
      { fieldCaption: 'Time', function: 'TRUNC_DAY', fieldAlias: 'Day' },
      { fieldCaption: 'Event ID', function: 'COUNT', fieldAlias: 'Events' },
    ], filters(), 'daily').then(function (rows) {
      return rows.map(function (r) {
        var raw = val(r, 'Day', 'TRUNC_DAY(Time)');
        var m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
        return { day: m ? m[2] + '/' + m[3] : String(raw), sort: String(raw),
          events: num(val(r, 'Events', 'COUNT(Event ID)')) };
      }).sort(function (a, b) { return a.sort < b.sort ? -1 : 1; });
    });
  }

  // ---- 描画 ------------------------------------------------------------------
  function tile(label) {
    var value = el('div', { class: 'kit-tile-value', text: '–' });
    var node = el('div', { class: 'tile' }, [el('div', { class: 'kit-tile-label', text: label }), value]);
    return { node: node, set: function (text) { value.textContent = text; } };
  }

  function renderAreas(areas) {
    var top = areas.slice(0, 8);
    if (!top.length) { ui.areas.replaceChildren(el('div', { class: 'kit-empty', text: '該当なし' })); return; }
    var max = top[0].events;
    ui.areas.replaceChildren.apply(ui.areas, top.map(function (a) {
      var selected = state.area === a.area;
      return el('button', {
        class: 'kit-bar-row is-clickable' + (state.area && !selected ? ' is-dim' : ''),
        type: 'button',
        'aria-pressed': selected ? 'true' : 'false',
        title: a.area + ': ' + a.events + ' 件 / 最大 M' + a.maxMag.toFixed(1),
        onclick: function () {
          state.area = selected ? null : a.area;
          if (!state.area) globe.resetZoom();
          refresh();
        },
      }, [
        el('span', { class: 'kit-bar-label', text: a.area }),
        el('span', { class: 'kit-bar-track' }, el('span', {
          class: 'kit-bar-fill', style: { display: 'block', width: (a.events / max * 100) + '%' },
        })),
        el('span', { class: 'kit-bar-value', text: a.events.toLocaleString('en-US') }),
      ]);
    }));
  }

  function renderHistogram(points) {
    var bins = [];
    for (var m = Math.floor(state.minMag); m <= 6; m++) bins.push({ m: m, n: 0 });
    points.forEach(function (p) {
      var b = bins[Math.min(6, Math.floor(p.mag)) - Math.floor(state.minMag)];
      if (b) b.n += 1;
    });
    Kit.columns(ui.hist, bins.map(function (b) {
      return { label: 'M' + b.m, values: [b.n], tip: ['M' + b.m + '.0–' + b.m + '.9', b.n.toLocaleString('en-US') + ' 件'] };
    }), { tip: tip });
  }

  function renderDaily(days) {
    Kit.columns(ui.daily, days.map(function (d) {
      return { label: d.day, values: [d.events], tip: [d.day + '(UTC)', d.events.toLocaleString('en-US') + ' 件'] };
    }), { tip: tip });
  }

  function renderDetail(p) {
    if (!p) {
      ui.detail.replaceChildren(el('div', { class: 'kit-tile-note', text: '地球儀の点をクリックすると詳細を表示します。' }));
      return;
    }
    function row(k, v) { return el('div', { class: 'detail-row' }, [el('span', { text: k }), el('strong', { text: v })]); }
    ui.detail.replaceChildren(
      el('div', { class: 'detail-title', text: 'M' + p.mag.toFixed(1) + ' — ' + p.place }),
      row('発生時刻 (UTC)', String(p.when).replace('T', ' ').slice(0, 19)),
      row('深さ', p.depth.toFixed(1) + ' km'),
      row('緯度 / 経度', p.lat.toFixed(2) + ', ' + p.lon.toFixed(2)),
    );
  }

  function section(host, promise, render) {
    return promise.then(render).catch(function (err) {
      host.replaceChildren(el('div', { class: 'kit-error', text: 'クエリに失敗: ' + Kit.errorText(err) }));
    });
  }

  function refresh() {
    var mine = ++requestId;
    var fresh = function (fn) { return function (x) { if (mine === requestId) fn(x); }; };
    ui.root.classList.add('is-loading');
    ui.areaChip.style.display = state.area ? '' : 'none';
    ui.areaChipText.textContent = state.area || '';

    var started = performance.now();
    Promise.all([
      section(ui.stage, fetchPoints(), fresh(function (points) {
        globe.setPoints(points);
        renderHistogram(points);
        renderDetail(null);
        ui.empty.style.display = points.length ? 'none' : '';
        if (state.area && points.length) {
          var top = points.reduce(function (a, b) { return b.mag > a.mag ? b : a; });
          globe.focus(top.lon, top.lat, 3);
          ui.spin.setAttribute('aria-pressed', 'false');
        }
      })),
      section(ui.tiles, fetchKpis(), fresh(function (k) {
        ui.tEvents.set(k.events.toLocaleString('en-US'));
        ui.tMax.set(k.events ? 'M' + k.maxMag.toFixed(1) : '–');
        ui.tDepth.set(k.events ? k.avgDepth.toFixed(0) + ' km' : '–');
        ui.tAreas.set(k.areas.toLocaleString('en-US'));
      })),
      section(ui.areas, fetchAreas(), fresh(renderAreas)),
      section(ui.daily, fetchDaily(), fresh(renderDaily)),
    ]).then(function () {
      if (mine !== requestId) return;
      ui.root.classList.remove('is-loading');
      ui.foot.textContent = '今回の更新 ' + Math.round(performance.now() - started) +
        ' ms(累計 ' + Kit.stats.queries + ' 本、キャッシュ利用 ' + Kit.stats.cacheHits + ' 回)· データ: USGS All Earthquakes, 2018-01-31〜02-07(同梱 CSV)';
    });
  }

  // ---- 画面の骨組み(データが来る前に描く) ---------------------------------
  function mount() {
    tip = Kit.tooltip();
    var canvas = el('canvas', { class: 'globe', 'aria-label': '地震の発生地点を示す地球儀' });

    var magValue = el('output', { class: 'mag-value', text: 'M' + state.minMag.toFixed(1) + ' 以上' });
    var mag = el('input', {
      type: 'range', min: 0, max: 6, step: 0.5, value: state.minMag, 'aria-label': '最小マグニチュード',
    });
    var apply = Kit.debounce(refresh, 250);
    mag.addEventListener('input', function () {
      state.minMag = Number(mag.value);
      magValue.textContent = 'M' + state.minMag.toFixed(1) + ' 以上';
      apply();
    });

    var type = el('select', { 'aria-label': '種別' }, [
      el('option', { value: 'earthquake', text: '地震のみ' }),
      el('option', { value: '', text: 'すべての種別' }),
    ]);
    type.addEventListener('change', function () { state.type = type.value || null; refresh(); });

    ui.spin = el('button', { class: 'kit-btn', type: 'button', 'aria-pressed': 'true', text: '自動回転' });
    ui.spin.addEventListener('click', function () {
      var on = !globe.isSpinning();
      globe.setSpinning(on);
      ui.spin.setAttribute('aria-pressed', String(on));
    });

    ui.areaChipText = el('span');
    ui.areaChip = el('button', {
      class: 'chip', type: 'button', style: { display: 'none' }, title: '地域の絞り込みを解除',
      onclick: function () { state.area = null; globe.resetZoom(); refresh(); },
    }, [ui.areaChipText, el('span', { class: 'chip-x', text: '×' })]);

    ui.tEvents = tile('地震の件数');
    ui.tMax = tile('最大マグニチュード');
    ui.tDepth = tile('平均の深さ');
    ui.tAreas = tile('地域の数');
    ui.tiles = el('div', { class: 'tiles' }, [ui.tEvents.node, ui.tMax.node, ui.tDepth.node, ui.tAreas.node]);

    ui.areas = el('div', { class: 'kit-bars' });
    ui.hist = el('div');
    ui.daily = el('div');
    ui.detail = el('div', { class: 'detail' });
    ui.empty = el('div', { class: 'stage-empty', style: { display: 'none' }, text: 'この条件に当てはまる地震はありません' });
    ui.foot = el('div', { class: 'kit-foot', text: 'Tableau に接続中…' });

    var legend = el('div', { class: 'legend' }, [
      el('span', { class: 'legend-title', text: '深さ (km)' }),
    ].concat(Globe.DEPTH_COLORS.map(function (color, i) {
      var from = i === 0 ? 0 : Globe.DEPTH_STOPS[i - 1];
      var label = i === Globe.DEPTH_COLORS.length - 1 ? from + '+' : from + '–' + Globe.DEPTH_STOPS[i];
      return el('span', { class: 'legend-item' }, [
        el('span', { class: 'swatch', style: { background: color } }), label,
      ]);
    })).concat([el('span', { class: 'legend-note', text: '円の大きさ = マグニチュード' })]));

    ui.stage = el('div', { class: 'stage kit-card' }, [
      canvas, ui.empty, legend,
      el('div', { class: 'zoom' }, [
        el('button', { class: 'kit-btn', type: 'button', 'aria-label': '拡大', text: '+', onclick: function () { globe.zoomBy(1.3); } }),
        el('button', { class: 'kit-btn', type: 'button', 'aria-label': '縮小', text: '−', onclick: function () { globe.zoomBy(1 / 1.3); } }),
      ]),
    ]);

    ui.root = el('div', { class: 'layout kit-mounted' }, [
      el('header', { class: 'top' }, [
        el('div', {}, [
          el('h1', { text: 'Globe Explorer' }),
          el('p', { class: 'sub', text: '世界の地震 1 週間 — ドラッグで回転、ホイールで拡大' }),
        ]),
        el('div', { class: 'controls' }, [
          el('label', { class: 'control' }, [el('span', { text: '最小マグニチュード' }), mag, magValue]),
          el('label', { class: 'control' }, [el('span', { text: '種別' }), type]),
          ui.areaChip,
          ui.spin,
        ]),
      ]),
      el('main', { class: 'main' }, [
        ui.stage,
        el('aside', { class: 'side' }, [
          el('section', { class: 'kit-card' }, ui.tiles),
          el('section', { class: 'kit-card' }, [el('h2', {}, ['地域別の件数', el('small', { text: 'クリックで絞り込み' })]), ui.areas]),
          el('section', { class: 'kit-card' }, [el('h2', { text: 'マグニチュードの分布' }), ui.hist]),
          el('section', { class: 'kit-card' }, [el('h2', {}, ['日別の件数', el('small', { text: 'UTC' })]), ui.daily]),
          el('section', { class: 'kit-card' }, [el('h2', { text: '選択中の地震' }), ui.detail]),
        ]),
      ]),
      ui.foot,
    ]);
    document.getElementById('app').replaceChildren(ui.root);

    globe = Globe.create(canvas, {
      onHover: function (p, e) {
        if (!p) { tip.hide(); return; }
        tip.show(e, ['M' + p.mag.toFixed(1) + ' — ' + p.place,
          '深さ ' + p.depth.toFixed(1) + ' km', String(p.when).replace('T', ' ').slice(0, 16) + ' UTC']);
      },
      onSelect: renderDetail,
    });
    renderDetail(null);
  }

  mount();
  Kit.boot(function (ctx) {
    ds = Kit.requireSource(ctx, SOURCE);
    refresh();
  });
})();
