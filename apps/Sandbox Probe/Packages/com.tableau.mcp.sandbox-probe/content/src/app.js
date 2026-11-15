// ============================================================================
// Sandbox Probe — Data App の実行環境と API の挙動を、実際に試して一覧にする検証用アプリ。
//
// 「ドキュメントにこう書いてある」ではなく「このサイトで今どう動くか」を記録するのが目的。
// 各テストは 1 つの事実だけを確かめ、結果(可 / 不可 / 情報)と生の応答を残す。
// 末尾の JSON をコピーすれば、検証結果をそのまま共有できる。
//
// 読み取り専用: データの書き込み・外部への送信はしない(外部 URL へのアクセスは
// 「遮断されること」を確かめるための GET だけで、クエリ結果などは一切送らない)。
// ============================================================================
(function () {
  'use strict';
  var el = Kit.el;

  var SOURCE = 'Earthquakes';
  var TIMEOUT_MS = 12000;
  var results = [];
  var violations = [];
  var policy = null;
  var ds = null;
  var ui = {};

  document.addEventListener('securitypolicyviolation', function (e) {
    if (!policy) policy = e.originalPolicy;
    violations.push({ blocked: e.blockedURI, directive: e.effectiveDirective || e.violatedDirective });
  });

  // ---- 小道具 ----------------------------------------------------------------
  function brief(value, max) {
    var text;
    try { text = typeof value === 'string' ? value : JSON.stringify(value); } catch (e) { text = String(value); }
    if (text == null) text = String(value);
    max = max || 600;
    return text.length > max ? text.slice(0, max) + ' …(' + text.length + ' 文字)' : text;
  }

  function errorInfo(err) {
    if (err == null) return { message: 'unknown' };
    if (typeof err !== 'object') return { message: String(err) };
    var out = { name: err.name, message: err.message };
    if (err.errorCode) out.errorCode = err.errorCode;
    Object.keys(err).forEach(function (k) { if (!(k in out)) out[k] = err[k]; });
    return out;
  }

  var ok = function (detail) { return { status: 'ok', detail: detail }; };
  var blocked = function (detail) { return { status: 'blocked', detail: detail }; };
  var info = function (detail) { return { status: 'info', detail: detail }; };

  function withTimeout(promise) {
    return Promise.race([
      promise,
      new Promise(function (resolve) {
        setTimeout(function () { resolve(blocked({ message: TIMEOUT_MS + ' ms 応答なし(タイムアウト)' })); }, TIMEOUT_MS);
      }),
    ]);
  }

  /** 例外・拒否は「不可」として記録する(テスト自体は止めない)。 */
  function attempt(fn) {
    try {
      return withTimeout(Promise.resolve(fn()).catch(function (err) { return blocked(errorInfo(err)); }));
    } catch (err) {
      return Promise.resolve(blocked(errorInfo(err)));
    }
  }

  /** 要素の読み込み成否を待つ(img / script / iframe)。 */
  function loads(node, parent) {
    return new Promise(function (resolve) {
      node.addEventListener('load', function () { resolve(true); });
      node.addEventListener('error', function () { resolve(false); });
      (parent || document.head).appendChild(node);
      setTimeout(function () { resolve(false); }, 6000);
    }).then(function (loaded) { node.remove(); return loaded; });
  }

  function runQuery(query, options) {
    var started = performance.now();
    return ds.queryAsync(query, options).then(function (res) {
      var rows = res && Array.isArray(res.data) ? res.data : null;
      return {
        ms: Math.round(performance.now() - started),
        rows: rows ? rows.length : null,
        keys: rows && rows[0] && !Array.isArray(rows[0]) ? Object.keys(rows[0]) : undefined,
        first: rows ? rows[0] : undefined,
        raw: res,
      };
    });
  }

  /** クエリが通れば「可」。行数・キー・先頭行を残す。 */
  function queryTest(query, options) {
    return function () {
      return runQuery(query, options).then(function (r) {
        return ok({ ms: r.ms, rows: r.rows, keys: r.keys, first: r.first });
      });
    };
  }

  /** 関数名などを 1 つずつ試し、通ったもの・通らなかったものを分けて返す。 */
  function eachOf(names, makeQuery) {
    return function () {
      var passed = [], failed = {};
      return names.reduce(function (chain, name) {
        return chain.then(function () {
          return runQuery(makeQuery(name)).then(function (r) {
            passed.push(name + '=' + brief(r.first && r.first.v, 40));
          }, function (err) { failed[name] = errorInfo(err).message || 'error'; });
        });
      }, Promise.resolve()).then(function () {
        var detail = { ok: passed, ng: failed };
        return Object.keys(failed).length ? (passed.length ? info(detail) : blocked(detail)) : ok(detail);
      });
    };
  }

  var COUNT = { fieldCaption: 'Event ID', function: 'COUNT', fieldAlias: 'n' };
  var setFilter = function (field, values, extra) {
    return Object.assign({ field: { fieldCaption: field }, filterType: 'SET', values: values }, extra || {});
  };

  // ---- テスト定義 --------------------------------------------------------------
  // expect: ドキュメント等から予想される結果('ok' | 'blocked')。無ければ観察のみ。
  var TESTS = [
    // --- 実行環境 ---
    { group: '実行環境', title: 'ページのオリジンと URL', run: function () {
      return info({ origin: location.origin, selfOrigin: window.origin, protocol: location.protocol,
        host: location.host, path: location.pathname.replace(/[0-9a-f-]{20,}/gi, '<id>'),
        inIframe: window.top !== window, secureContext: window.isSecureContext,
        referrer: document.referrer ? new URL(document.referrer).origin : '' });
    } },
    { group: '実行環境', title: 'tableau.extensions.environment', run: function () {
      var env = tableau.extensions.environment || {}, out = {};
      ['apiVersion', 'context', 'mode', 'tableauVersion', 'operatingSystem', 'language', 'locale', 'country']
        .forEach(function (k) { out[k] = env[k]; });
      out.otherKeys = Object.keys(env).filter(function (k) { return !(k in out); });
      return info(out);
    } },
    { group: '実行環境', title: 'tableau.extensions が公開している名前空間', run: function () {
      var ext = tableau.extensions;
      var names = function (o) {
        if (!o) return null;
        var set = new Set(Object.keys(o));
        var proto = Object.getPrototypeOf(o);
        if (proto && proto !== Object.prototype) Object.getOwnPropertyNames(proto).forEach(function (k) { set.add(k); });
        set.delete('constructor');
        return Array.from(set).sort();
      };
      return info({ extensions: names(ext), workbook: names(ext.workbook),
        worksheetContent: !!ext.worksheetContent, dashboardContent: !!ext.dashboardContent,
        worksheet: ext.worksheetContent ? names(ext.worksheetContent.worksheet) : null });
    } },
    { group: '実行環境', title: 'ブラウザと画面', run: function () {
      return info({ userAgent: navigator.userAgent, viewport: innerWidth + 'x' + innerHeight,
        devicePixelRatio: devicePixelRatio, language: navigator.language });
    } },

    // --- サンドボックス ---
    { group: 'サンドボックス', title: 'パッケージ内ファイルを fetch()', expect: 'blocked',
      note: '同梱ファイルでも fetch は null オリジン扱いで失敗するはず(<script src> は可)', run: function () {
        return fetch('src/probe-data.json').then(function (r) { return r.text(); })
          .then(function (t) { return ok({ body: brief(t, 80) }); });
      } },
    { group: 'サンドボックス', title: 'パッケージ内ファイルを XMLHttpRequest', expect: 'blocked', run: function () {
      return new Promise(function (resolve) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'src/probe-data.json');
        xhr.onload = function () { resolve(ok({ status: xhr.status, body: brief(xhr.responseText, 80) })); };
        xhr.onerror = function () { resolve(blocked({ message: 'XHR error', status: xhr.status })); };
        xhr.send();
      });
    } },
    { group: 'サンドボックス', title: 'パッケージ内の画像を <img> で表示', expect: 'ok', run: function () {
      return loads(el('img', { src: 'src/probe-pixel.png' }), document.body)
        .then(function (loaded) { return loaded ? ok({}) : blocked({}); });
    } },
    { group: 'サンドボックス', title: 'data: URI の画像', expect: 'ok', run: function () {
      var src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      return loads(el('img', { src: src }), document.body).then(function (l) { return l ? ok({}) : blocked({}); });
    } },
    { group: 'サンドボックス', title: '外部サイトへ fetch()(example.com)', expect: 'blocked',
      note: 'サイト管理者の許可オリジン + manifest の requestedOrigins の両方が無いと CSP で遮断', run: function () {
        return fetch('https://example.com/', { mode: 'cors' }).then(function (r) { return ok({ status: r.status }); });
      } },
    { group: 'サンドボックス', title: '外部サイトへ fetch()(no-cors)', expect: 'blocked', run: function () {
      return fetch('https://example.com/', { mode: 'no-cors' }).then(function (r) { return ok({ type: r.type }); });
    } },
    { group: 'サンドボックス', title: '外部の画像を <img> で表示', expect: 'blocked', run: function () {
      return loads(el('img', { src: 'https://www.tableau.com/favicon.ico?probe=1' }), document.body)
        .then(function (l) { return l ? ok({}) : blocked({}); });
    } },
    { group: 'サンドボックス', title: 'CDN のスクリプトを <script src> で読み込み', expect: 'blocked',
      note: 'ライブラリは同梱が必須になる', run: function () {
        return loads(el('script', { src: 'https://cdn.jsdelivr.net/npm/d3-array@3.2.4/dist/d3-array.min.js' }))
          .then(function (l) { return l ? ok({}) : blocked({}); });
      } },
    { group: 'サンドボックス', title: '外部の CSS / Web フォント(Google Fonts)', expect: 'blocked', run: function () {
      return loads(el('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter&display=swap' }))
        .then(function (l) { return l ? ok({}) : blocked({}); });
    } },
    { group: 'サンドボックス', title: 'WebSocket で外部に接続', expect: 'blocked', run: function () {
      return new Promise(function (resolve) {
        var ws = new WebSocket('wss://echo.websocket.org/');
        ws.onopen = function () { ws.close(); resolve(ok({})); };
        ws.onerror = function () { resolve(blocked({ message: 'WebSocket error' })); };
      });
    } },
    { group: 'サンドボックス', title: 'インラインスクリプトの実行', expect: 'ok', run: function () {
      window.__probeInline = 0;
      var s = el('script', { text: 'window.__probeInline = 1;' });
      document.head.appendChild(s); s.remove();
      return window.__probeInline === 1 ? ok({}) : blocked({});
    } },
    { group: 'サンドボックス', title: 'eval / new Function', expect: 'ok',
      note: 'Vega など実行時にコード生成するライブラリが動くかの目安', run: function () {
        var a = (0, eval)('1 + 1'), b = new Function('return 40 + 2')();
        return ok({ eval: a, newFunction: b });
      } },
    { group: 'サンドボックス', title: 'ES モジュールの動的 import(同梱ファイル)', run: function () {
      return import('./probe-module.mjs').then(function (m) { return ok({ value: m.default }); });
    } },
    { group: 'サンドボックス', title: 'iframe(外部サイト)', expect: 'blocked', note: 'frame-src は開けられない固定の制限', run: function () {
      var before = violations.length;
      var frame = el('iframe', { src: 'https://example.com/', style: { width: '1px', height: '1px', border: '0' } });
      return loads(frame, document.body).then(function () {
        var hit = violations.slice(before).some(function (v) { return /frame/.test(v.directive); });
        return hit ? blocked({ directive: 'frame-src' }) : info({ message: 'CSP 違反は記録されなかった' });
      });
    } },
    { group: 'サンドボックス', title: 'iframe(srcdoc / 自前の HTML)', run: function () {
      var before = violations.length;
      var frame = el('iframe', { srcdoc: '<p>probe</p>', style: { width: '1px', height: '1px', border: '0' } });
      return loads(frame, document.body).then(function (loaded) {
        var hit = violations.slice(before).some(function (v) { return /frame/.test(v.directive); });
        return hit ? blocked({ directive: 'frame-src' }) : (loaded ? ok({}) : blocked({}));
      });
    } },
    { group: 'サンドボックス', title: 'WebGL', note: '3D 地球儀などを WebGL で描けるか', run: function () {
      var canvas = document.createElement('canvas');
      var gl2 = canvas.getContext('webgl2'), gl = gl2 || canvas.getContext('webgl');
      if (!gl) return blocked({ message: 'getContext が null' });
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return ok({ version: gl2 ? 'webgl2' : 'webgl', renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) });
    } },
    { group: 'サンドボックス', title: 'Web Worker(Blob URL)', run: function () {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(new Blob(['postMessage(6 * 7)'], { type: 'text/javascript' }));
        var worker = new Worker(url);
        worker.onmessage = function (e) { worker.terminate(); resolve(ok({ value: e.data })); };
        worker.onerror = function (e) { reject(new Error(e.message || 'worker error')); };
      });
    } },
    { group: 'サンドボックス', title: 'Web Worker(同梱ファイル)', run: function () {
      return new Promise(function (resolve, reject) {
        var worker = new Worker('src/probe-worker.js');
        worker.onmessage = function (e) { worker.terminate(); resolve(ok({ value: e.data })); };
        worker.onerror = function (e) { reject(new Error(e.message || 'worker error')); };
      });
    } },
    { group: 'サンドボックス', title: 'localStorage / sessionStorage', note: '設定の保存に使えるか', run: function () {
      localStorage.setItem('__probe', '1');
      var v = localStorage.getItem('__probe');
      localStorage.removeItem('__probe');
      sessionStorage.setItem('__probe', '1'); sessionStorage.removeItem('__probe');
      return ok({ roundTrip: v === '1' });
    } },
    { group: 'サンドボックス', title: 'IndexedDB', run: function () {
      return new Promise(function (resolve, reject) {
        var req = indexedDB.open('__probe', 1);
        req.onsuccess = function () { req.result.close(); indexedDB.deleteDatabase('__probe'); resolve(ok({})); };
        req.onerror = function () { reject(req.error || new Error('indexedDB error')); };
      });
    } },
    { group: 'サンドボックス', title: 'document.cookie', run: function () {
      document.cookie = '__probe=1; SameSite=Lax';
      var has = /__probe=1/.test(document.cookie);
      document.cookie = '__probe=; Max-Age=0';
      return has ? ok({}) : blocked({ message: '書いた cookie が読めない' });
    } },
    { group: 'サンドボックス', title: '親フレームの DOM へのアクセス', expect: 'blocked', run: function () {
      var title = window.parent.document.title;
      return ok({ parentTitleLength: title.length });
    } },
    { group: 'サンドボックス', title: 'Extensions API の settings(保存)', note: 'ワークブックに設定値を持てるか(保存は試さず有無のみ)', run: function () {
      var s = tableau.extensions.settings;
      if (!s) return blocked({ message: 'settings が無い' });
      return ok({ existingKeys: Object.keys(s.getAll() || {}), saveAsync: typeof s.saveAsync });
    } },

    // --- データ API ---
    { group: 'データ API', title: 'workbook.getAllDataSourcesAsync()', expect: 'ok', run: function () {
      return tableau.extensions.workbook.getAllDataSourcesAsync().then(function (list) {
        return ok(list.map(function (d) {
          return { name: d.name, id: d.id, isExtract: d.isExtract, isPublished: d.isPublished,
            extractUpdateTime: d.extractUpdateTime, fields: d.fields ? d.fields.length : undefined };
        }));
      });
    } },
    { group: 'データ API', title: 'worksheet.getDataSourcesAsync()(従来の取り方)', run: function () {
      return tableau.extensions.worksheetContent.worksheet.getDataSourcesAsync().then(function (list) {
        return ok(list.map(function (d) { return d.name; }));
      });
    } },
    { group: 'データ API', title: 'readMetadataAsync()', expect: 'ok', run: function () {
      return ds.readMetadataAsync().then(function (res) {
        var rows = res && Array.isArray(res.data) ? res.data : [];
        return ok({ topLevelKeys: Object.keys(res || {}), fields: rows.length, sample: rows.slice(0, 3) });
      });
    } },
    { group: 'データ API', title: 'queryAsync(): 応答の形', expect: 'ok', run: function () {
      return runQuery({ fields: [{ fieldCaption: 'Event Type' }, COUNT] }).then(function (r) {
        return ok({ ms: r.ms, topLevelKeys: Object.keys(r.raw || {}), rows: r.rows, first: r.first });
      });
    } },
    { group: 'データ API', title: '別名(fieldAlias)なしの集計列のキー名', note: '"SUM(Magnitude)" の形になるか', run:
      queryTest({ fields: [{ fieldCaption: 'Event Type' }, { fieldCaption: 'Magnitude', function: 'SUM' }] }) },
    { group: 'データ API', title: '集計関数', run: eachOf(
      ['SUM', 'AVG', 'MEDIAN', 'COUNT', 'COUNTD', 'MIN', 'MAX', 'STDEV', 'VAR'],
      function (fn) { return { fields: [{ fieldCaption: 'Magnitude', function: fn, fieldAlias: 'v' }] }; }) },
    { group: 'データ API', title: '日付関数(日時フィールド)', run: eachOf(
      ['YEAR', 'QUARTER', 'MONTH', 'WEEK', 'DAY', 'TRUNC_YEAR', 'TRUNC_QUARTER', 'TRUNC_MONTH', 'TRUNC_WEEK', 'TRUNC_DAY'],
      function (fn) { return { fields: [{ fieldCaption: 'Time', function: fn, fieldAlias: 'v' }, COUNT] }; }) },
    { group: 'データ API', title: '明細(集計なし)の取得と行数', note: 'CSV は 1,707 行。上限で切られるか', run: function () {
      return runQuery({ fields: [{ fieldCaption: 'Event ID' }, { fieldCaption: 'Place' }] }).then(function (r) {
        return ok({ ms: r.ms, rows: r.rows, expected: 1707, first: r.first });
      });
    } },
    { group: 'データ API', title: 'メジャーを関数なしで指定', note: '行レベルの値が返るか、エラーか、既定の集計か', run:
      queryTest({ fields: [{ fieldCaption: 'Event ID' }, { fieldCaption: 'Magnitude' }] }) },
    { group: 'データ API', title: 'ビン(binSize)', run:
      queryTest({ fields: [{ fieldCaption: 'Magnitude', binSize: 1, fieldAlias: 'bin' }, COUNT] }) },
    { group: 'データ API', title: '計算フィールド(集計式)', run:
      queryTest({ fields: [{ fieldCaption: 'Avg Mag', calculation: 'SUM([Magnitude]) / COUNT([Event ID])' }] }) },
    { group: 'データ API', title: '計算フィールド(行レベル式をディメンションに)', run:
      queryTest({ fields: [{ fieldCaption: 'Mag Floor', calculation: 'FLOOR([Magnitude])' }, COUNT] }) },
    { group: 'データ API', title: '並べ替え(sortDirection / sortPriority)', run: function () {
      return runQuery({ fields: [{ fieldCaption: 'Area' },
        Object.assign({ sortDirection: 'DESC', sortPriority: 1 }, COUNT)] }).then(function (r) {
        var counts = r.raw.data.map(function (row) { return Number(row.n); });
        var sorted = counts.every(function (v, i) { return i === 0 || counts[i - 1] >= v; });
        var detail = { rows: r.rows, top3: r.raw.data.slice(0, 3), sortedDesc: sorted };
        return sorted ? ok(detail) : info(detail);
      });
    } },
    { group: 'データ API', title: 'maxDecimalPlaces', run:
      queryTest({ fields: [{ fieldCaption: 'Depth Km', function: 'AVG', fieldAlias: 'v', maxDecimalPlaces: 1 }] }) },
    { group: 'データ API', title: 'フィルター: SET', expect: 'ok', run:
      queryTest({ fields: [{ fieldCaption: 'Area' }, COUNT], filters: [setFilter('Area', ['Japan', 'Taiwan'])] }) },
    { group: 'データ API', title: 'フィルター: SET(exclude)', run:
      queryTest({ fields: [{ fieldCaption: 'Event Type' }, COUNT], filters: [setFilter('Event Type', ['earthquake'], { exclude: true })] }) },
    { group: 'データ API', title: 'フィルター: MATCH(contains)', run:
      queryTest({ fields: [COUNT], filters: [{ field: { fieldCaption: 'Place' }, filterType: 'MATCH', contains: 'Japan' }] }) },
    { group: 'データ API', title: 'フィルター: TOP N', run:
      queryTest({ fields: [{ fieldCaption: 'Area' }, COUNT], filters: [{ field: { fieldCaption: 'Area' }, filterType: 'TOP',
        howMany: 5, direction: 'TOP', fieldToMeasure: { fieldCaption: 'Event ID', function: 'COUNT' } }] }) },
    { group: 'データ API', title: 'フィルター: 数値の範囲(RANGE)', run:
      queryTest({ fields: [COUNT], filters: [{ field: { fieldCaption: 'Magnitude' }, filterType: 'QUANTITATIVE_NUMERICAL',
        quantitativeFilterType: 'RANGE', min: 4, max: 5 }] }) },
    { group: 'データ API', title: 'フィルター: 数値の下限(MIN)', run:
      queryTest({ fields: [COUNT], filters: [{ field: { fieldCaption: 'Magnitude' }, filterType: 'QUANTITATIVE_NUMERICAL',
        quantitativeFilterType: 'MIN', min: 4.5 }] }) },
    { group: 'データ API', title: 'フィルター: 集計値に対する条件', note: '件数 20 以上の地域だけ(HAVING 相当)', run:
      queryTest({ fields: [{ fieldCaption: 'Area' }, COUNT], filters: [{ field: { fieldCaption: 'Event ID', function: 'COUNT' },
        filterType: 'QUANTITATIVE_NUMERICAL', quantitativeFilterType: 'MIN', min: 20 }] }) },
    { group: 'データ API', title: 'フィルター: 日付の範囲(QUANTITATIVE_DATE)', run:
      queryTest({ fields: [COUNT], filters: [{ field: { fieldCaption: 'Time' }, filterType: 'QUANTITATIVE_DATE',
        quantitativeFilterType: 'RANGE', minDate: '2018-02-03', maxDate: '2018-02-05' }] }) },
    { group: 'データ API', title: 'フィルター: 相対日付(DATE / LASTN)', run:
      queryTest({ fields: [COUNT], filters: [{ field: { fieldCaption: 'Time' }, filterType: 'DATE',
        periodType: 'YEARS', dateRangeType: 'LASTN', rangeN: 20 }] }) },
    { group: 'データ API', title: '該当 0 件のときの応答', run:
      queryTest({ fields: [{ fieldCaption: 'Area' }, COUNT], filters: [setFilter('Area', ['__no_such_area__'])] }) },
    { group: 'データ API', title: '存在しないフィールド(エラーの形)', expect: 'blocked', note: 'エラーオブジェクトに何が入るか', run:
      queryTest({ fields: [{ fieldCaption: '__no_such_field__' }] }) },
    { group: 'データ API', title: 'オプション: returnFormat = ARRAYS', run: function () {
      return ds.queryAsync({ fields: [{ fieldCaption: 'Event Type' }, COUNT] }, { returnFormat: 'ARRAYS' })
        .then(function (res) { return ok({ topLevelKeys: Object.keys(res || {}), sample: brief(res, 300) }); });
    } },
    { group: 'データ API', title: 'オプション: disaggregate = true', run: function () {
      return ds.queryAsync({ fields: [{ fieldCaption: 'Magnitude' }] }, { disaggregate: true })
        .then(function (res) { return ok({ rows: res && res.data ? res.data.length : null, first: res && res.data && res.data[0] }); });
    } },
    { group: 'データ API', title: '応答時間(同じ形のクエリを 5 回・直列)', run: function () {
      var times = [];
      var step = function (i) {
        if (i === 5) return Promise.resolve();
        return runQuery({ fields: [{ fieldCaption: 'Area' }, Object.assign({}, COUNT, { fieldAlias: 'n' + i })] })
          .then(function (r) { times.push(r.ms); return step(i + 1); });
      };
      return step(0).then(function () { return info({ ms: times }); });
    } },
    { group: 'データ API', title: '並列 10 本の同時クエリ', note: '同時実行で失敗や制限が出るか', run: function () {
      var started = performance.now();
      var jobs = [];
      for (var i = 0; i < 10; i++) {
        jobs.push(runQuery({ fields: [{ fieldCaption: 'Mag Type' }, Object.assign({}, COUNT, { fieldAlias: 'p' + i })] })
          .then(function () { return true; }, function (err) { return errorInfo(err).message || 'error'; }));
      }
      return Promise.all(jobs).then(function (res) {
        var failed = res.filter(function (r) { return r !== true; });
        var detail = { totalMs: Math.round(performance.now() - started), succeeded: 10 - failed.length, errors: failed.slice(0, 2) };
        return failed.length ? info(detail) : ok(detail);
      });
    } },
    { group: 'データ API', title: 'getSummaryDataAsync()(マークカードのデータ)', note: 'Data App はエンコードを持たないので空のはず', run: function () {
      return tableau.extensions.worksheetContent.worksheet.getSummaryDataAsync().then(function (t) {
        return ok({ columns: t.columns.length, rows: t.data.length });
      });
    } },
    { group: 'データ API', title: 'getLogicalTablesAsync()(従来 API)', run: function () {
      return ds.getLogicalTablesAsync().then(function (tables) {
        return ok(tables.map(function (t) { return t.caption || t.id; }));
      });
    } },

    // --- Tableau REST API(fetch ブリッジ)---
    { group: 'REST API', title: 'REST 用メソッドの名前', note: 'ドキュメントは fetch()、同梱ライブラリの実装は fetchAsync', run: function () {
      var ext = tableau.extensions;
      return info({ 'extensions.fetch': typeof ext.fetch, 'extensions.fetchAsync': typeof ext.fetchAsync });
    } },
    { group: 'REST API', title: 'GET /api/{api-version}/serverinfo', note: 'サイト設定で許可されたパスだけ通るはず', run: restTest('/api/{api-version}/serverinfo') },
    { group: 'REST API', title: 'GET …/sites/{site-id}/projects?pageSize=1', run: restTest('/api/{api-version}/sites/{site-id}/projects?pageSize=1') },
    { group: 'REST API', title: 'GET …/sites/{site-id}(サイト情報)', run: restTest('/api/{api-version}/sites/{site-id}') },
  ];

  function restTest(url) {
    return function () {
      var ext = tableau.extensions;
      var call = typeof ext.fetchAsync === 'function' ? ext.fetchAsync : ext.fetch;
      if (typeof call !== 'function') return blocked({ message: 'fetch / fetchAsync が公開されていない' });
      return call.call(ext, url, { method: 'GET', headers: { Accept: 'application/json' } }).then(function (res) {
        var detail = { ok: res.ok, status: res.status, statusText: res.statusText, body: brief(res.body, 160) };
        return res.ok ? ok(detail) : blocked(detail);
      });
    };
  }

  // ---- 手動テスト(ユーザー操作が必要なもの) ---------------------------------
  var MANUAL = [
    { title: 'ポップアップ(window.open)', note: 'サイト設定「ポップアップを許可」に依存', run: function () {
      var w = window.open('about:blank', '_blank', 'width=320,height=200');
      if (!w) return blocked({ message: 'window.open が null を返した' });
      w.close();
      return ok({});
    } },
    { title: 'クリップボードへ書き込み', run: function () {
      return navigator.clipboard.writeText('Sandbox Probe').then(function () { return ok({}); });
    } },
    { title: 'ファイルのダウンロード(Blob + a[download])', note: '結果 JSON を保存できるか', run: function () {
      var url = URL.createObjectURL(new Blob([exportJson()], { type: 'application/json' }));
      var a = el('a', { href: url, download: 'sandbox-probe.json' });
      document.body.appendChild(a); a.click(); a.remove();
      return info({ message: 'クリックは実行した。保存されたかはブラウザ側で確認' });
    } },
  ];

  // ---- 画面 ------------------------------------------------------------------
  var LABEL = { ok: '可', blocked: '不可', info: '情報', running: '実行中', pending: '待機' };

  function exportJson() {
    return JSON.stringify({
      app: 'Sandbox Probe', ranAt: new Date().toISOString(),
      csp: policy, cspViolations: violations,
      results: results.map(function (r) {
        return { group: r.group, title: r.title, expect: r.expect || null, status: r.status,
          matchesExpectation: r.expect ? r.expect === r.status : null, detail: r.detail };
      }),
    }, null, 2);
  }

  function row(test) {
    var chip = el('span', { class: 'chip is-pending', text: LABEL.pending });
    var detail = el('code', { class: 'detail' });
    var mark = el('span', { class: 'mark' });
    var node = el('tr', {}, [
      el('td', { class: 'c-status' }, chip),
      el('td', { class: 'c-title' }, [
        el('div', { text: test.title }),
        test.note ? el('div', { class: 'note', text: test.note }) : null,
      ]),
      el('td', { class: 'c-expect' }, [test.expect ? '予想: ' + LABEL[test.expect] : '', mark]),
      el('td', { class: 'c-detail' }, detail),
    ]);
    return {
      node: node,
      set: function (status, value) {
        chip.className = 'chip is-' + status;
        chip.textContent = LABEL[status];
        detail.textContent = value == null ? '' : brief(value, 900);
        if (test.expect && (status === 'ok' || status === 'blocked')) {
          mark.textContent = test.expect === status ? ' ✓ 一致' : ' ✗ 予想と違う';
          mark.className = 'mark ' + (test.expect === status ? 'is-match' : 'is-diff');
        }
      },
    };
  }

  function runAll() {
    results = [];
    ui.run.disabled = true;
    var rows = TESTS.map(function (test) { return { test: test, view: row(test) }; });
    var groups = [];
    rows.forEach(function (r) { if (groups.indexOf(r.test.group) < 0) groups.push(r.test.group); });
    ui.body.replaceChildren.apply(ui.body, groups.map(function (group) {
      return el('section', { class: 'kit-card group' }, [
        el('h2', { text: group }),
        el('table', {}, el('tbody', {}, rows.filter(function (r) { return r.test.group === group; })
          .map(function (r) { return r.view.node; }))),
      ]);
    }));

    return rows.reduce(function (chain, r) {
      return chain.then(function () {
        r.view.set('running');
        return attempt(function () { return r.test.run(); }).then(function (res) {
          r.view.set(res.status, res.detail);
          results.push({ group: r.test.group, title: r.test.title, expect: r.test.expect, status: res.status, detail: res.detail });
          summarize();
        });
      });
    }, Promise.resolve()).then(function () {
      ui.run.disabled = false;
      summarize(true);
    });
  }

  function summarize(done) {
    var count = { ok: 0, blocked: 0, info: 0 }, diff = 0;
    results.forEach(function (r) {
      count[r.status] += 1;
      if (r.expect && r.expect !== r.status && r.status !== 'info') diff += 1;
    });
    ui.summary.textContent = (done ? '完了' : '実行中 ' + results.length + ' / ' + TESTS.length) +
      ' — 可 ' + count.ok + ' · 不可 ' + count.blocked + ' · 情報 ' + count.info + ' · 予想と違う ' + diff;
    ui.policy.textContent = policy || '(CSP 違反がまだ発生していないため未取得)';
    ui.violations.textContent = violations.length
      ? violations.map(function (v) { return v.directive + '  ←  ' + v.blocked; }).join('\n') : '(なし)';
    ui.export.value = exportJson();
  }

  function mount() {
    ui.summary = el('div', { class: 'summary', text: 'Tableau に接続中…' });
    ui.run = el('button', { class: 'kit-btn', type: 'button', text: 'もう一度実行', disabled: true, onclick: runAll });
    ui.body = el('div', { class: 'groups' });
    ui.policy = el('pre', { class: 'pre' });
    ui.violations = el('pre', { class: 'pre' });
    ui.export = el('textarea', { class: 'export', readonly: true, rows: 10, 'aria-label': '検証結果の JSON' });
    ui.export.addEventListener('focus', function () { ui.export.select(); });

    var manual = el('table', {}, el('tbody', {}, MANUAL.map(function (test) {
      var view = row(test);
      view.node.firstChild.replaceChildren(el('button', {
        class: 'kit-btn', type: 'button', text: '試す',
        onclick: function () {
          attempt(function () { return test.run(); }).then(function (res) {
            var cell = view.node.children[3].firstChild;
            cell.textContent = LABEL[res.status] + '  ' + brief(res.detail, 300);
            results = results.filter(function (r) { return r.title !== test.title; });
            results.push({ group: '手動', title: test.title, status: res.status, detail: res.detail });
            summarize(true);
          });
        },
      }));
      return view.node;
    })));

    document.getElementById('app').replaceChildren(el('div', { class: 'layout kit-mounted' }, [
      el('header', { class: 'top' }, [
        el('div', {}, [
          el('h1', { text: 'Sandbox Probe' }),
          el('p', { class: 'sub', text: 'Data App の実行環境と API を実際に試して記録する検証用アプリ' }),
        ]),
        el('div', { class: 'controls' }, [ui.summary, ui.run]),
      ]),
      ui.body,
      el('section', { class: 'kit-card group' }, [el('h2', {}, ['手動テスト', el('small', { text: 'ボタン操作が必要なもの' })]), manual]),
      el('section', { class: 'kit-card group' }, [el('h2', { text: '適用されている Content-Security-Policy' }), ui.policy]),
      el('section', { class: 'kit-card group' }, [el('h2', { text: '記録された CSP 違反' }), ui.violations]),
      el('section', { class: 'kit-card group' }, [
        el('h2', {}, ['検証結果(JSON)', el('small', { text: 'クリックで全選択 → コピーして共有' })]), ui.export,
      ]),
    ]));
  }

  mount();
  Kit.boot(function (ctx) {
    ds = ctx.byName[SOURCE] || ctx.list[0] || null;
    if (!ds) throw new Error('ワークブックにデータソースが配線されていません');
    return runAll();
  });
})();
