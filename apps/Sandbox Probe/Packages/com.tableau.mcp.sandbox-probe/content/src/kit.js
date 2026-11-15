// ============================================================================
// kit.js — Data App 共通の小さな土台(各アプリの content/src/ にコピーして使う)。
//
// サンドボックスの前提をここに閉じ込める:
//   * コンソールが見えないので、起動時の例外は必ず画面に出す
//   * 先に描画し、あとから initializeAsync する(真っ白な時間を作らない)
//   * 実データは innerHTML に入れない(el() は textContent / createElement だけ使う)
//   * データソースは位置ではなく名前(caption)で引く
// 編集するのは shared/kit.js。tools/sync-shared.sh で各アプリへ配る。
// ============================================================================
(function () {
  'use strict';

  var stats = { queries: 0, cacheHits: 0, fallbackQueries: 0, fallbackReason: null, rows: 0, ms: 0, log: [] };
  var cache = new Map();

  /** 安全な DOM 生成。attrs の on* はリスナー、style はオブジェクト、それ以外は属性。 */
  function el(tag, attrs, children) {
    var svg = /^(svg|g|path|rect|circle|line|text|polyline|title)$/.test(tag);
    var node = svg
      ? document.createElementNS('http://www.w3.org/2000/svg', tag)
      : document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value == null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    });
    [].concat(children || []).forEach(function (child) {
      if (child == null) return;
      node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function errorText(err) {
    if (err == null) return 'unknown error';
    if (typeof err === 'string') return err;
    return err.message || err.errorCode || JSON.stringify(err);
  }

  /** 起動に失敗したとき、プレースホルダを置き換えて原因を画面に出す。 */
  function fatal(err) {
    var root = document.getElementById('app');
    if (!root) return;
    root.replaceChildren(
      el('div', { class: 'kit-fatal' }, [
        el('strong', { text: 'Data app を開始できませんでした' }),
        el('p', { text: errorText(err) }),
      ]),
    );
  }

  window.addEventListener('error', function (e) {
    if (!document.querySelector('.kit-mounted')) fatal(e.error || e.message);
  });
  window.addEventListener('unhandledrejection', function (e) {
    if (!document.querySelector('.kit-mounted')) fatal(e.reason);
  });

  function getDataSources() {
    var wb = tableau.extensions.workbook;
    if (wb && typeof wb.getAllDataSourcesAsync === 'function') return wb.getAllDataSourcesAsync();
    var wc = tableau.extensions.worksheetContent;
    if (wc && wc.worksheet && typeof wc.worksheet.getDataSourcesAsync === 'function') {
      return wc.worksheet.getDataSourcesAsync();
    }
    return Promise.resolve([]);
  }

  /**
   * Extensions API を初期化し、ワークブックのデータソースを名前引きできる形で渡す。
   * @param {(ctx: { list: object[], byName: Object<string, object> }) => any} main
   */
  function boot(main) {
    if (!window.tableau || !tableau.extensions) {
      fatal('Extensions API が読み込まれていません(Tableau の外で開いていませんか)');
      return;
    }
    tableau.extensions
      .initializeAsync()
      .then(getDataSources)
      .then(function (list) {
        var byName = Object.create(null);
        (list || []).forEach(function (ds) {
          byName[ds.name] = ds;
        });
        return main({ list: list || [], byName: byName });
      })
      .catch(fatal);
  }

  /** 名前でデータソースを取り出す。無ければ、何が配線されているかを添えて失敗する。 */
  function requireSource(ctx, name) {
    var ds = ctx.byName[name];
    if (ds) return ds;
    var names = ctx.list.map(function (d) { return d.name; });
    throw new Error(
      'データソース "' + name + '" がワークブックに配線されていません。配線済み: ' +
        (names.length ? names.join(', ') : '(なし)'),
    );
  }

  /**
   * VDS クエリを 1 本実行して行配列を返す。本数・行数・所要時間を stats に積む。
   * 同じクエリ(データソース・fields・filters が一致)はセッション内でキャッシュし、
   * フィルターを戻したときなどに API を叩き直さない。最新を取り直すなら clearCache()。
   */
  function query(ds, fields, filters, label) {
    var body = { fields: fields, filters: filters || [] };
    var key = ds.name + '|' + JSON.stringify(body);
    if (cache.has(key)) {
      stats.cacheHits += 1;
      return cache.get(key);
    }
    var started = performance.now();
    var promise = ds.queryAsync(body).catch(function (err) {
      if (!fallbackSources[ds.name] || !window.LocalQuery) throw err;
      // queryAsync が使えない(利用上限など)。従来 API で明細を読み、ブラウザ内で集計する。
      stats.fallbackQueries += 1;
      stats.fallbackReason = errorText(err);
      return loadRows(ds).then(function (rows) { return window.LocalQuery.run(rows, body); });
    }).then(function (res) {
      var rows = res && Array.isArray(res.data) ? res.data : [];
      var ms = performance.now() - started;
      stats.queries += 1;
      stats.rows += rows.length;
      stats.ms += ms;
      stats.log.push({ label: label || '', rows: rows.length, ms: Math.round(ms) });
      return rows;
    });
    cache.set(key, promise);
    promise.catch(function () { cache.delete(key); }); // 失敗は残さない
    return promise;
  }

  function clearCache() { cache.clear(); }

  var fallbackSources = Object.create(null);
  var tableRows = Object.create(null);

  /**
   * queryAsync が失敗したときに、従来 API(getLogicalTableDataAsync)で明細を全件読み、
   * ブラウザ内で同じクエリを評価する代替経路を、このデータソースに対して有効にする。
   *
   * 明細がそのままブラウザに届くので、行数が少なく、全員に見せてよいデータにだけ使う
   * (個人情報を含むデータソースでは有効にしない)。従来 API の上限は 10,000 行。
   */
  function enableLocalFallback(ds) { fallbackSources[ds.name] = true; }

  function loadRows(ds) {
    if (tableRows[ds.name]) return tableRows[ds.name];
    tableRows[ds.name] = ds.getLogicalTablesAsync().then(function (tables) {
      return ds.getLogicalTableDataAsync(tables[0].id);
    }).then(function (table) {
      return table.data.map(function (cells) {
        var row = {};
        table.columns.forEach(function (column, i) {
          var cell = cells[i], native = cell.nativeValue;
          // 日付は Date になるので、VDS と同じ "YYYY-MM-DD hh:mm:ss" 形の文字列(value)を使う
          row[column.fieldName] = native instanceof Date ? cell.value : native;
        });
        return row;
      });
    });
    tableRows[ds.name].catch(function () { delete tableRows[ds.name]; });
    return tableRows[ds.name];
  }

  /** 集計列を読む。別名が効かない場合に備えて "FUNC(Caption)" 形のキーにもフォールバックする。 */
  function val(row, alias, fallbackKey) {
    if (row[alias] != null) return row[alias];
    if (fallbackKey != null && row[fallbackKey] != null) return row[fallbackKey];
    return null;
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  /** 1,284 / 12.9K / 4.2M */
  function compact(n) {
    var abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (abs >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return Math.round(n).toLocaleString('en-US');
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }

  /** ポインタ追従のツールチップ。show(event, [行の文字列...]) / hide()。 */
  function tooltip() {
    var node = el('div', { class: 'kit-tip', role: 'tooltip' });
    document.body.appendChild(node);
    return {
      show: function (event, lines) {
        node.replaceChildren.apply(
          node,
          lines.map(function (line, i) {
            return el('div', { class: i === 0 ? 'kit-tip-title' : 'kit-tip-line', text: line });
          }),
        );
        node.style.display = 'block';
        var w = node.offsetWidth, h = node.offsetHeight;
        var x = Math.min(event.clientX + 14, window.innerWidth - w - 8);
        var y = event.clientY + 14 + h > window.innerHeight ? event.clientY - h - 10 : event.clientY + 14;
        node.style.left = Math.max(8, x) + 'px';
        node.style.top = Math.max(8, y) + 'px';
      },
      hide: function () {
        node.style.display = 'none';
      },
    };
  }

  /**
   * 縦棒チャート(SVG)。1 系列でも複数系列(横並び)でも描ける。
   * @param {Element} host
   * @param {{ label: string, values: number[], tip: string[] }[]} bars
   * @param {{ colors?: string[], empty?: string, tip?: object, labelEvery?: number }} [opts]
   */
  function columns(host, bars, opts) {
    opts = opts || {};
    var colors = opts.colors || ['#2a78d6'];
    if (!bars.length) {
      host.replaceChildren(el('div', { class: 'kit-empty', text: opts.empty || '該当なし' }));
      return;
    }
    var W = 300, H = 104, padB = 16, padT = 14;
    var n = bars[0].values.length;
    var max = 0, peak = null;
    bars.forEach(function (b) {
      b.values.forEach(function (v, k) {
        if (v > max) { max = v; peak = { bar: b, k: k }; }
      });
    });
    max = max || 1;
    var slot = W / bars.length;
    var bw = Math.min(24, (slot - 4 - (n - 1) * 2) / n);
    var group = bw * n + (n - 1) * 2;
    var every = opts.labelEvery || Math.ceil(bars.length / 10);
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'kit-columns', role: 'img' });
    svg.appendChild(el('line', { x1: 0, x2: W, y1: H - padB, y2: H - padB, stroke: '#c3c2b7', 'stroke-width': 1 }));
    bars.forEach(function (b, i) {
      var x0 = i * slot + (slot - group) / 2;
      b.values.forEach(function (v, k) {
        var h = Math.max(v > 0 ? 2 : 0, (v / max) * (H - padB - padT));
        if (!h) return;
        var x = x0 + k * (bw + 2), y = H - padB - h, r = Math.min(4, h, bw / 2);
        // 上端だけ丸め、基線側は直角
        svg.appendChild(el('path', {
          fill: colors[k % colors.length],
          d: 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
            'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + y + ' ' + (x + bw) + ',' + (y + r) + 'V' + (y + h) + 'Z',
        }));
        if (peak && peak.bar === b && peak.k === k) {
          svg.appendChild(el('text', {
            x: x + bw / 2, y: y - 3, 'text-anchor': 'middle', class: 'kit-columns-peak',
            text: opts.format ? opts.format(v) : v.toLocaleString('en-US'),
          }));
        }
      });
      if (i % every === 0) {
        svg.appendChild(el('text', {
          x: i * slot + slot / 2, y: H - 4, 'text-anchor': 'middle', class: 'kit-columns-tick', text: b.label,
        }));
      }
      var hit = el('rect', { x: i * slot, y: 0, width: slot, height: H - padB, fill: 'transparent' });
      if (opts.tip) {
        hit.addEventListener('pointermove', function (e) { opts.tip.show(e, b.tip); });
        hit.addEventListener('pointerleave', opts.tip.hide);
      }
      svg.appendChild(hit);
    });
    host.replaceChildren(svg);
  }

  /**
   * 横棒のランキング。onClick を渡すと行がボタンになり、選択中以外は淡く表示する。
   * @param {Element} host
   * @param {{ label: string, value: number, display?: string, title?: string }[]} items
   * @param {{ selected?: string|null, onClick?: (label: string) => void, color?: string }} [opts]
   */
  function bars(host, items, opts) {
    opts = opts || {};
    if (!items.length) {
      host.replaceChildren(el('div', { class: 'kit-empty', text: opts.empty || '該当なし' }));
      return;
    }
    var max = Math.max.apply(null, items.map(function (i) { return i.value; })) || 1;
    host.replaceChildren.apply(host, items.map(function (item) {
      var selected = opts.selected === item.label;
      var clickable = !!opts.onClick;
      return el(clickable ? 'button' : 'div', {
        class: 'kit-bar-row' + (clickable ? ' is-clickable' : '') + (opts.selected && !selected ? ' is-dim' : ''),
        type: clickable ? 'button' : null,
        'aria-pressed': clickable ? String(selected) : null,
        title: item.title || item.label,
        onclick: clickable ? function () { opts.onClick(item.label); } : null,
      }, [
        el('span', { class: 'kit-bar-label', text: item.label }),
        el('span', { class: 'kit-bar-track' }, el('span', {
          class: 'kit-bar-fill',
          style: { display: 'block', width: Math.max(0, item.value / max * 100) + '%', background: opts.color || null },
        })),
        el('span', { class: 'kit-bar-value', text: item.display != null ? item.display : item.value.toLocaleString('en-US') }),
      ]);
    }));
  }

  /** 凡例(2 系列以上のときに必ず添える)。items: [{ label, color }] */
  function legend(items) {
    return el('div', { class: 'kit-legend' }, items.map(function (item) {
      return el('span', { class: 'kit-legend-item' }, [
        el('span', { class: 'kit-legend-swatch', style: { background: item.color } }), item.label,
      ]);
    }));
  }

  window.Kit = {
    el: el, fatal: fatal, boot: boot, requireSource: requireSource, query: query, clearCache: clearCache, enableLocalFallback: enableLocalFallback,
    val: val, num: num, compact: compact, debounce: debounce, tooltip: tooltip,
    columns: columns, bars: bars, legend: legend, errorText: errorText, stats: stats,
  };
})();
