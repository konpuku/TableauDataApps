// ============================================================================
// mock-tableau.js — ローカルプレビュー専用の Extensions API モック。
//
// Data App の queryAsync は Tableau の中でしか動かない。レイアウトや操作を手元で
// 確かめるため、preview サーバーが src/tableau.extensions.1.latest.min.js の代わりに
// このファイルを返し、VizQL Data Service のクエリのうちよく使う部分を
// ブラウザ内の配列に対して評価する。
//
// 対応: フィールド関数 SUM/AVG/MIN/MAX/COUNT/COUNTD/MEDIAN、日付の YEAR/MONTH/DAY と
// TRUNC_*、binSize、フィルター SET / MATCH / QUANTITATIVE_NUMERICAL /
// QUANTITATIVE_DATE / TOP、sortPriority。
// 非対応: calculation(計算式)、parameters、相対日付(DATE)。投げると例外になる。
// 本物の VDS と挙動が一致する保証はない。最終確認は必ずパブリッシュ後に Tableau で行う。
// ============================================================================
(function () {
  'use strict';
  var SOURCES = window.__MOCK_SOURCES__ || {};
  var LATENCY = 120;
  var FAIL_QUERY = /[?&]failQuery=1/.test(location.search);

  var run = window.LocalQuery.run; // shared/local-query.js(preview サーバーが先に連結する)

  function later(fn) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try { resolve(fn()); } catch (e) { reject(e); }
      }, LATENCY);
    });
  }

  function dataSource(name) {
    var rows = SOURCES[name];
    return {
      name: name,
      id: 'mock.' + name,
      queryAsync: function (query) {
        // ?failQuery=1 で、利用上限に達したときと同じ失敗を再現する(代替経路の確認用)
        if (FAIL_QUERY) return Promise.reject(Object.assign(new Error('internal-error: error'), { errorCode: 'internal-error' }));
        return later(function () { return run(rows, query); });
      },
      getLogicalTablesAsync: function () { return later(function () { return [{ id: 'mock-table', caption: name }]; }); },
      getLogicalTableDataAsync: function () {
        return later(function () {
          var names = Object.keys(rows[0] || {});
          return {
            columns: names.map(function (n, i) { return { fieldName: n, index: i }; }),
            totalRowCount: rows.length,
            data: rows.map(function (row) {
              return names.map(function (n) { return { value: row[n], nativeValue: row[n], formattedValue: String(row[n]) }; });
            }),
          };
        });
      },
      readMetadataAsync: function () {
        return later(function () {
          var first = rows[0] || {};
          return { data: Object.keys(first).map(function (caption) {
            return { fieldName: caption, fieldCaption: caption,
              dataType: typeof first[caption] === 'number' ? 'REAL' : 'STRING' };
          }) };
        });
      },
    };
  }

  window.tableau = {
    __mock: true,
    extensions: {
      initializeAsync: function () { return later(function () {}); },
      environment: { mode: 'mock', context: 'preview', apiVersion: 'mock', tableauVersion: 'mock' },
      workbook: {
        getAllDataSourcesAsync: function () {
          return later(function () { return Object.keys(SOURCES).map(dataSource); });
        },
      },
      worksheetContent: { worksheet: { name: 'mock' } },
    },
  };
})();
