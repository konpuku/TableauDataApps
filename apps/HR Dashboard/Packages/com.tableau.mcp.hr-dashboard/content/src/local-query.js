// ============================================================================
// local-query.js — VizQL Data Service 形式のクエリを、ブラウザ内の行配列に対して評価する小さなエンジン。
//
// 使いどころは 2 つ:
//   1. ローカルプレビューのモック(tools/preview/mock-tableau.js)
//   2. queryAsync が使えないときの代替経路(kit.js の enableLocalFallback)
//
// 対応: 集計 SUM/AVG/MIN/MAX/COUNT/COUNTD/MEDIAN、日付の YEAR/QUARTER/MONTH/DAY と TRUNC_*、
//       binSize、フィルター SET / MATCH / QUANTITATIVE_NUMERICAL / QUANTITATIVE_DATE / TOP、sortPriority。
// 非対応: calculation(計算式)、parameters、相対日付(DATE)、集計値に対するフィルター。
// 本物の VDS と結果が一致する保証はない。
// ============================================================================
(function () {
  'use strict';

  var AGG = {
    SUM: function (v) { return v.reduce(function (a, b) { return a + Number(b); }, 0); },
    AVG: function (v) { return v.length ? AGG.SUM(v) / v.length : null; },
    MIN: function (v) { return v.length ? v.reduce(function (a, b) { return b < a ? b : a; }) : null; },
    MAX: function (v) { return v.length ? v.reduce(function (a, b) { return b > a ? b : a; }) : null; },
    COUNT: function (v) { return v.length; },
    COUNTD: function (v) { return new Set(v).size; },
    MEDIAN: function (v) {
      if (!v.length) return null;
      var s = v.map(Number).sort(function (a, b) { return a - b; });
      var m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    },
  };

  var pad = function (n) { return String(n).padStart(2, '0'); };
  function parts(value) {
    var m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}))?/);
    return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
  }
  var DATE_FN = {
    YEAR: function (p) { return p.y; },
    QUARTER: function (p) { return Math.ceil(p.mo / 3); },
    MONTH: function (p) { return p.mo; },
    DAY: function (p) { return p.d; },
    TRUNC_YEAR: function (p) { return p.y + '-01-01'; },
    TRUNC_QUARTER: function (p) { return p.y + '-' + pad((Math.ceil(p.mo / 3) - 1) * 3 + 1) + '-01'; },
    TRUNC_MONTH: function (p) { return p.y + '-' + pad(p.mo) + '-01'; },
    TRUNC_DAY: function (p) { return p.y + '-' + pad(p.mo) + '-' + pad(p.d); },
  };

  function need(row, caption) {
    if (!(caption in row)) throw new Error('Unknown field "' + caption + '"');
    return row[caption];
  }

  function passes(row, f) {
    var v = need(row, f.field.fieldCaption);
    switch (f.filterType) {
      case 'SET': {
        var hit = f.values.some(function (x) { return String(x) === String(v); });
        return f.exclude ? !hit : hit;
      }
      case 'MATCH': {
        var s = String(v == null ? '' : v);
        var ok = (!f.startsWith || s.indexOf(f.startsWith) === 0) &&
          (!f.endsWith || s.slice(-f.endsWith.length) === f.endsWith) &&
          (!f.contains || s.indexOf(f.contains) >= 0);
        return f.exclude ? !ok : ok;
      }
      case 'QUANTITATIVE_NUMERICAL':
        if (v == null || v === '') return !!f.includeNulls;
        if (f.quantitativeFilterType === 'ONLY_NULL') return false;
        return (f.min == null || Number(v) >= f.min) && (f.max == null || Number(v) <= f.max);
      case 'QUANTITATIVE_DATE': {
        if (v == null || v === '') return !!f.includeNulls;
        var day = String(v).slice(0, 10);
        return (!f.minDate || day >= f.minDate.slice(0, 10)) && (!f.maxDate || day <= f.maxDate.slice(0, 10));
      }
      case 'TOP':
        return true; // 集計後に適用
      default:
        throw new Error('local-query: filterType "' + f.filterType + '" は未対応');
    }
  }

  function keyOf(field) {
    if (field.fieldAlias) return field.fieldAlias;
    return field.function ? field.function + '(' + field.fieldCaption + ')' : field.fieldCaption;
  }

  function run(rows, query) {
    if (!query || !Array.isArray(query.fields) || !query.fields.length) throw new Error('fields is required');
    var filters = query.filters || [];
    var kept = rows.filter(function (row) {
      return filters.every(function (f) { return passes(row, f); });
    });

    var dims = [], measures = [];
    query.fields.forEach(function (field) {
      if (field.calculation) throw new Error('local-query: calculation は未対応 (' + field.fieldCaption + ')');
      var fn = field.function;
      if (fn && AGG[fn]) measures.push(field);
      else if (fn && DATE_FN[fn]) dims.push({ field: field, get: function (row) {
        var p = parts(need(row, field.fieldCaption)); return p ? DATE_FN[fn](p) : null;
      } });
      else if (fn) throw new Error('local-query: function "' + fn + '" は未対応');
      else if (field.binSize) dims.push({ field: field, get: function (row) {
        var v = need(row, field.fieldCaption);
        return v == null ? null : Math.floor(Number(v) / field.binSize) * field.binSize;
      } });
      else dims.push({ field: field, get: function (row) { return need(row, field.fieldCaption); } });
    });

    var groups = new Map();
    kept.forEach(function (row) {
      var values = dims.map(function (d) { return d.get(row); });
      var key = JSON.stringify(values);
      var g = groups.get(key);
      if (!g) { g = { values: values, rows: [] }; groups.set(key, g); }
      g.rows.push(row);
    });
    if (!dims.length && !groups.size) groups.set('[]', { values: [], rows: [] });

    function aggregate(g, field) {
      var values = g.rows.map(function (row) { return need(row, field.fieldCaption); })
        .filter(function (v) { return v != null && v !== ''; });
      return AGG[field.function](values);
    }

    var out = Array.from(groups.values()).map(function (g) {
      var row = {};
      dims.forEach(function (d, i) { row[keyOf(d.field)] = g.values[i]; });
      measures.forEach(function (field) { row[keyOf(field)] = aggregate(g, field); });
      Object.defineProperty(row, '__group', { value: g });
      return row;
    });

    filters.filter(function (f) { return f.filterType === 'TOP'; }).forEach(function (f) {
      var dimKey = f.field.fieldCaption;
      var totals = new Map();
      out.forEach(function (row) {
        var k = row[dimKey];
        var bucket = totals.get(k) || { rows: [] };
        bucket.rows = bucket.rows.concat(row.__group.rows);
        totals.set(k, bucket);
      });
      var ranked = Array.from(totals.entries()).map(function (entry) {
        return [entry[0], aggregate(entry[1], f.fieldToMeasure)];
      }).sort(function (a, b) { return f.direction === 'BOTTOM' ? a[1] - b[1] : b[1] - a[1]; })
        .slice(0, f.howMany).map(function (e) { return e[0]; });
      out = out.filter(function (row) { return ranked.indexOf(row[dimKey]) >= 0; });
    });

    var sorts = query.fields.filter(function (f) { return f.sortPriority; })
      .sort(function (a, b) { return a.sortPriority - b.sortPriority; });
    out.sort(function (a, b) {
      for (var i = 0; i < sorts.length; i++) {
        var k = keyOf(sorts[i]), dir = sorts[i].sortDirection === 'DESC' ? -1 : 1;
        if (a[k] < b[k]) return -dir;
        if (a[k] > b[k]) return dir;
      }
      return 0;
    });
    return { data: out };
  }

  window.LocalQuery = { run: run };
})();
