// ============================================================================
// charts.js — 5 つの手口(描き方は 7 種類)それぞれについて、「誤解を招く版」と「正直な版」を SVG で描く。
//
//   var out = Charts.render(kind, { data, params, deceptive, style, title, t });
//   out.svg      … 描いた <svg>
//   out.measure  … ずれの大きさを説明するための数値(app.js が文言に差し込む)
//
// 同じ data から両方を描くのが肝心。違いは描き方(deceptive と params)だけにある。
// 誤解を招く版には必ず「教材」の透かしを入れ、切り取られても例だと分かるようにする。
// ============================================================================
(function () {
  'use strict';
  var el = Kit.el;
  var W = 560, H = 360;
  var TAU = Math.PI * 2;

  // ---- 共通の小道具 ----------------------------------------------------------
  function fmt(n, digits) {
    return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits == null ? 1 : digits });
  }

  /** 0 か base から top までの、切りのよい目盛り。 */
  function ticks(min, max, count) {
    var span = max - min || 1;
    var raw = span / (count || 5);
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * pow; })
      .filter(function (s) { return s >= raw; })[0] || 10 * pow;
    var out = [];
    for (var v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }

  function niceMax(max) {
    var t = ticks(0, max, 5);
    var step = t[1] - t[0];
    return Math.ceil(max / step) * step;
  }

  /** 枠・見出し・透かしを描き、プロット領域を返す。 */
  function frame(o, margin) {
    var s = o.style;
    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.title,
      style: { fontFamily: s.font, display: 'block', width: '100%', height: 'auto' },
    });
    svg.appendChild(el('rect', { x: 0, y: 0, width: W, height: H, fill: s.bg }));
    svg.appendChild(el('text', {
      x: 20, y: 16 + s.size, fill: s.ink, 'font-size': s.size + 4, 'font-weight': 700, text: o.title,
    }));
    if (o.deceptive) {
      svg.appendChild(el('text', {
        x: W - 12, y: H - 8, 'text-anchor': 'end', fill: s.ink, 'fill-opacity': 0.45,
        'font-size': 10, text: o.t('watermark'),
      }));
    }
    var m = Object.assign({ top: 46 + s.size, right: 24, bottom: 46, left: 56 }, margin || {});
    return { svg: svg, x: m.left, y: m.top, w: W - m.left - m.right, h: H - m.top - m.bottom, tick: Math.max(9, s.size - 3) };
  }

  /** 縦軸(左または右)と横の補助線。 */
  function yAxis(p, o, scale, values, side, unit, hideLabels) {
    var s = o.style, right = side === 'right';
    values.forEach(function (v) {
      var y = scale(v);
      if (!right) {
        p.svg.appendChild(el('line', { x1: p.x, x2: p.x + p.w, y1: y, y2: y, stroke: s.ink, 'stroke-opacity': 0.12, 'stroke-width': 1 }));
      }
      if (!hideLabels) {
        p.svg.appendChild(el('text', {
          x: right ? p.x + p.w + 6 : p.x - 6, y: y + p.tick * 0.35, 'text-anchor': right ? 'start' : 'end',
          fill: s.ink, 'fill-opacity': 0.7, 'font-size': p.tick, text: fmt(v),
        }));
      }
    });
    if (unit && !hideLabels) {
      // 単位は軸の真上、図の端にそろえて置く(軸ラベルの桁数に関係なく切れない位置)
      p.svg.appendChild(el('text', {
        x: right ? W - 10 : 10, y: p.y - 10, 'text-anchor': right ? 'end' : 'start',
        fill: s.ink, 'fill-opacity': 0.7, 'font-size': p.tick, text: unit,
      }));
    }
  }

  function baseline(p, o) {
    p.svg.appendChild(el('line', {
      x1: p.x, x2: p.x + p.w, y1: p.y + p.h, y2: p.y + p.h, stroke: o.style.ink, 'stroke-opacity': 0.45, 'stroke-width': 1,
    }));
  }

  function xLabel(p, o, x, text) {
    p.svg.appendChild(el('text', {
      x: x, y: p.y + p.h + p.tick + 8, 'text-anchor': 'middle', fill: o.style.ink, 'fill-opacity': 0.8,
      'font-size': p.tick, text: text,
    }));
  }

  /** 縦棒。上端だけ丸め、基線側は直角。値は棒の上に置く。 */
  function columns(p, o, items, scale, suffix) {
    var slot = p.w / items.length, bw = Math.min(64, slot * 0.56), base = p.y + p.h;
    items.forEach(function (item, i) {
      var top = scale(item.value), h = Math.max(0, base - top);
      var x = p.x + i * slot + (slot - bw) / 2, r = Math.min(4, h);
      if (h > 0) {
        p.svg.appendChild(el('path', {
          fill: item.color, 'fill-opacity': item.opacity == null ? 1 : item.opacity,
          d: 'M' + x + ',' + base + 'V' + (top + r) + 'Q' + x + ',' + top + ' ' + (x + r) + ',' + top +
            'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + top + ' ' + (x + bw) + ',' + (top + r) + 'V' + base + 'Z',
        }));
      }
      p.svg.appendChild(el('text', {
        x: x + bw / 2, y: top - 6, 'text-anchor': 'middle', fill: o.style.ink,
        'font-size': p.tick + 1, 'font-weight': 600, text: fmt(item.value) + (suffix || ''),
      }));
      xLabel(p, o, x + bw / 2, item.label);
    });
  }

  function line(p, o, points, color) {
    p.svg.appendChild(el('polyline', {
      points: points.map(function (pt) { return pt[0] + ',' + pt[1]; }).join(' '),
      fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
    points.forEach(function (pt) {
      p.svg.appendChild(el('circle', { cx: pt[0], cy: pt[1], r: 4.5, fill: color, stroke: o.style.bg, 'stroke-width': 2 }));
    });
  }

  function legend(p, o, entries) {
    var x = p.x;
    entries.forEach(function (entry) {
      p.svg.appendChild(el('line', { x1: x, x2: x + 18, y1: H - 12, y2: H - 12, stroke: entry.color, 'stroke-width': 3, 'stroke-linecap': 'round' }));
      p.svg.appendChild(el('text', { x: x + 24, y: H - 8, fill: o.style.ink, 'font-size': p.tick, text: entry.label }));
      x += 40 + entry.label.length * p.tick * 0.95;
    });
  }

  // ---- 手口 1: 二軸 ----------------------------------------------------------
  function dual(o) {
    var d = o.data, s = o.style, big = d.series[0], small = d.series[1];
    var p = frame(o, { right: 58, bottom: 62 });
    var n = d.labels.length;
    var xAt = function (i) { return p.x + (n === 1 ? p.w / 2 : (i / (n - 1)) * p.w); };
    var leftMax = niceMax(Math.max.apply(null, big.values.concat(o.deceptive ? [] : small.values)));
    var rightMax = niceMax(Math.max.apply(null, small.values));
    var scale = function (max) { return function (v) { return p.y + p.h - (v / max) * p.h; }; };
    var left = scale(leftMax), right = o.deceptive ? scale(rightMax) : left;

    yAxis(p, o, left, ticks(0, leftMax, 5), 'left', o.t('dual_unit'));
    if (o.deceptive) yAxis(p, o, right, ticks(0, rightMax, 5), 'right', null, o.params.hideRight);
    baseline(p, o);
    d.labels.forEach(function (label, i) { xLabel(p, o, xAt(i), label); });
    line(p, o, big.values.map(function (v, i) { return [xAt(i), left(v)]; }), s.main);
    line(p, o, small.values.map(function (v, i) { return [xAt(i), right(v)]; }), s.accent);
    legend(p, o, [
      { label: big.name + (o.deceptive ? '(' + o.t('dual_leftAxis') + ')' : ''), color: s.main },
      { label: small.name + (o.deceptive ? '(' + o.t('dual_rightAxis') + ')' : ''), color: s.accent },
    ]);

    var last = n - 1;
    return { svg: p.svg, measure: {
      ratio: fmt(leftMax / rightMax, 0), a: small.name, b: big.name,
      times: fmt(big.values[last] / (small.values[last] || 1), 0),
    } };
  }

  // ---- 手口 2: 0 から始まらない棒 --------------------------------------------
  function truncate(o) {
    var items = o.data.items, s = o.style;
    var p = frame(o);
    var values = items.map(function (i) { return i.value; });
    var max = Math.max.apply(null, values), min = Math.min.apply(null, values);
    var base = o.deceptive ? Math.min(o.params.start, min - 0.1) : 0;
    var top = o.deceptive ? max + (max - base) * 0.12 : niceMax(max);
    var scale = function (v) { return p.y + p.h - ((v - base) / (top - base)) * p.h; };

    yAxis(p, o, scale, ticks(base, top, 5), 'left', o.t('truncate_unit'));
    baseline(p, o);
    columns(p, o, items.map(function (item, i) {
      return { label: item.label, value: item.value, color: i === 0 ? s.accent : s.main, opacity: i === 0 ? 1 : 0.75 };
    }), scale);

    var lowest = items.reduce(function (a, b) { return b.value < a.value ? b : a; });
    var visual = (items[0].value - base) / Math.max(1e-9, lowest.value - base);
    return { svg: p.svg, measure: {
      a: items[0].label, b: lowest.label,
      visual: fmt(visual, visual < 2 ? 2 : 1),
      actual: fmt(items[0].value / (lowest.value || 1), 2),
      diff: fmt(items[0].value - lowest.value, 1),
    } };
  }

  // ---- 手口 3: 間隔 ----------------------------------------------------------
  function interval(o) {
    var pts = o.data.points, s = o.style;
    var p = frame(o);
    var n = pts.length, x0 = pts[0].x, x1 = pts[n - 1].x;
    var even = o.deceptive && o.params.even;
    var xAt = function (i) {
      if (n === 1) return p.x + p.w / 2;
      return p.x + 10 + (even ? i / (n - 1) : (pts[i].x - x0) / (x1 - x0 || 1)) * (p.w - 20);
    };
    var max = niceMax(Math.max.apply(null, pts.map(function (pt) { return pt.value; })));
    var scale = function (v) { return p.y + p.h - (v / max) * p.h; };

    yAxis(p, o, scale, ticks(0, max, 5), 'left', o.t('interval_unit'));
    baseline(p, o);
    var lastLabelX = -Infinity;
    pts.forEach(function (pt, i) {
      // 正直な版では近い年のラベルが重なるので、重なる分は間引く(点は必ず描く)
      if (xAt(i) - lastLabelX > p.tick * 3.2 || i === n - 1) {
        if (i === n - 1 && xAt(i) - lastLabelX <= p.tick * 3.2) return;
        xLabel(p, o, xAt(i), pt.label);
        lastLabelX = xAt(i);
      }
    });
    line(p, o, pts.map(function (pt, i) { return [xAt(i), scale(pt.value)]; }), s.accent);

    var first = pts[1].x - pts[0].x, last = pts[n - 1].x - pts[n - 2].x;
    return { svg: p.svg, measure: { first: fmt(first), last: fmt(last), ratio: fmt(first / (last || 1), 1) } };
  }

  // ---- 手口 4: 3D の円グラフ -------------------------------------------------
  function pie3d(o) {
    var items = o.data.items, s = o.style;
    var p = frame(o, { left: 20, right: 20, bottom: 24 });
    var total = items.reduce(function (a, b) { return a + b.value; }, 0) || 1;
    var cx = W / 2, R = Math.min(p.w / 2 - 70, p.h / 2 - 6);
    var tilt = o.deceptive ? (o.params.tilt * Math.PI) / 180 : 0;
    var ry = R * Math.cos(tilt);
    var depth = o.deceptive ? o.params.depth * Math.sin(tilt) : 0;
    var cy = p.y + p.h / 2 - depth / 2;

    // 先頭の項目(自社)の中央を真下=手前に持ってくる。正直な版は 12 時から時計回り。
    var firstSpan = (items[0].value / total) * TAU;
    var start = o.deceptive && o.params.front ? Math.PI / 2 - firstSpan / 2 : -Math.PI / 2;
    var at = function (a, dy) { return [cx + R * Math.cos(a), cy + ry * Math.sin(a) + (dy || 0)]; };

    var slices = [], a0 = start;
    items.forEach(function (item, i) {
      var a1 = a0 + (item.value / total) * TAU;
      slices.push({ item: item, a0: a0, a1: a1, color: i === 0 ? s.accent : s.main,
        opacity: i === 0 ? 1 : Math.max(0.3, 0.85 - (i - 1) * 0.25), wall: 0 });
      a0 = a1;
    });

    // 側面: 手前側(角度 0〜π)に掛かる部分だけが見える。
    if (depth > 0.5) {
      slices.forEach(function (sl) {
        [-TAU, 0, TAU].forEach(function (shift) {
          var from = Math.max(sl.a0 + shift, 0), to = Math.min(sl.a1 + shift, Math.PI);
          if (to - from < 1e-6) return;
          var p1 = at(from), p2 = at(to), p3 = at(to, depth), p4 = at(from, depth);
          var d = 'M' + p1 + 'A' + R + ',' + ry + ' 0 0 1 ' + p2 + 'L' + p3 + 'A' + R + ',' + ry + ' 0 0 0 ' + p4 + 'Z';
          p.svg.appendChild(el('path', { d: d, fill: s.bg }));
          p.svg.appendChild(el('path', { d: d, fill: sl.color, 'fill-opacity': sl.opacity }));
          p.svg.appendChild(el('path', { d: d, fill: '#000', 'fill-opacity': 0.24 }));
          sl.wall += depth * R * (Math.cos(from) - Math.cos(to));
        });
      });
    }

    slices.forEach(function (sl) {
      var span = sl.a1 - sl.a0;
      var d = span >= TAU - 1e-6
        ? 'M' + at(0) + 'A' + R + ',' + ry + ' 0 1 1 ' + at(Math.PI) + 'A' + R + ',' + ry + ' 0 1 1 ' + at(0) + 'Z'
        : 'M' + cx + ',' + cy + 'L' + at(sl.a0) + 'A' + R + ',' + ry + ' 0 ' + (span > Math.PI ? 1 : 0) + ' 1 ' + at(sl.a1) + 'Z';
      p.svg.appendChild(el('path', { d: d, fill: sl.color, 'fill-opacity': sl.opacity, stroke: s.bg, 'stroke-width': 2 }));
    });

    slices.forEach(function (sl) {
      var mid = (sl.a0 + sl.a1) / 2, cos = Math.cos(mid), sin = Math.sin(mid);
      var showValue = !(o.deceptive && o.params.hideValues);
      var text = sl.item.label + (showValue ? ' ' + fmt((sl.item.value / total) * 100, 1) + '%' : '');
      var front = sin > 0 ? depth : 0;
      p.svg.appendChild(el('text', {
        x: cx + (R + 12) * cos, y: cy + (ry + 14) * sin + front * Math.max(0, sin) + p.tick * 0.35,
        'text-anchor': Math.abs(cos) < 0.3 ? 'middle' : cos > 0 ? 'start' : 'end',
        fill: s.ink, 'font-size': p.tick + 1, 'font-weight': sl === slices[0] ? 700 : 400, text: text,
      }));
    });

    // 見た目の面積 = 上の面 + 見えている側面。楕円に潰しても上の面どうしの比は変わらない。
    var topArea = Math.PI * R * ry;
    var visible = slices.map(function (sl) { return (sl.item.value / total) * topArea + sl.wall; });
    var visibleTotal = visible.reduce(function (a, b) { return a + b; }, 0) || 1;
    return { svg: p.svg, measure: {
      a: items[0].label, visual: fmt((visible[0] / visibleTotal) * 100, 1), actual: fmt((items[0].value / total) * 100, 1),
    } };
  }

  // ---- 手口 3(円): 面積の比率を歪める ---------------------------------------
  // ラベルの数値は正しいまま、2 番目の項目だけ扇形を広げて描く。
  function ratio(o) {
    var items = o.data.items, s = o.style;
    var p = frame(o, { left: 20, right: 20, bottom: 24 });
    var total = items.reduce(function (a, b) { return a + b.value; }, 0) || 1;
    var cx = W / 2, cy = p.y + p.h / 2, R = Math.min(p.w / 2 - 80, p.h / 2 - 4);
    var target = Math.min(1, items.length - 1);
    var real = items.map(function (i) { return i.value / total; });
    var drawn = real.slice();
    if (o.deceptive) {
      // 広げた分は、ほかの項目から割合に応じて削る
      var want = Math.min(0.9, real[target] + o.params.inflate / 100);
      var rest = 1 - real[target] || 1;
      drawn = real.map(function (r, i) { return i === target ? want : r * ((1 - want) / rest); });
    }
    var at = function (a, r) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    var a0 = -Math.PI / 2;
    items.forEach(function (item, i) {
      var a1 = a0 + drawn[i] * TAU, mid = (a0 + a1) / 2, cos = Math.cos(mid);
      p.svg.appendChild(el('path', {
        d: 'M' + cx + ',' + cy + 'L' + at(a0, R) + 'A' + R + ',' + R + ' 0 ' + (a1 - a0 > Math.PI ? 1 : 0) + ' 1 ' + at(a1, R) + 'Z',
        fill: i === target ? s.accent : s.main,
        'fill-opacity': i === target ? 1 : Math.max(0.25, 0.9 - (i > target ? i - 1 : i) * 0.2),
        stroke: s.bg, 'stroke-width': 2,
      }));
      var pos = at(mid, R + 12);
      p.svg.appendChild(el('text', {
        x: pos[0], y: pos[1] + p.tick * 0.35, 'text-anchor': Math.abs(cos) < 0.3 ? 'middle' : cos > 0 ? 'start' : 'end',
        fill: s.ink, 'font-size': p.tick + 1, 'font-weight': i === target ? 700 : 400,
        text: item.label + ' ' + fmt(real[i] * 100, 1) + '%',
      }));
      a0 = a1;
    });
    return { svg: p.svg, measure: {
      a: items[target].label, actual: fmt(real[target] * 100, 1), drawn: fmt(drawn[target] * 100, 1),
      times: fmt(drawn[target] / (real[target] || 1), 2),
    } };
  }

  // ---- 手口 4(棒): 遠近感で手前を大きく見せる -------------------------------
  // 奥から手前へ並べ、手前ほど拡大する。値がほぼ同じでも「増え続けている」ように見える。
  function bars3d(o) {
    var items = o.data.items, s = o.style, n = items.length;
    if (!o.deceptive) {
      var q = frame(o);
      var top = niceMax(Math.max.apply(null, items.map(function (i) { return i.value; })));
      var scale = function (v) { return q.y + q.h - (v / top) * q.h; };
      yAxis(q, o, scale, ticks(0, top, 5), 'left', o.t('bars3d_unit'));
      baseline(q, o);
      columns(q, o, items.map(function (item, i) {
        return { label: item.label, value: item.value, color: i === n - 1 ? s.accent : s.main, opacity: i === n - 1 ? 1 : 0.75 };
      }), scale);
      return { svg: q.svg, measure: {} };
    }

    var p = frame(o, { left: 30, right: 30, bottom: 20 });
    var max = Math.max.apply(null, items.map(function (i) { return i.value; })) || 1;
    var k = o.params.perspective / 100;                 // 0 = 遠近なし、1 = 手前が 2 倍
    var factor = function (i) { return 1 + k * (n === 1 ? 0 : i / (n - 1)); };
    var frontScale = factor(n - 1);
    var baseH = (p.h - 30) / frontScale * 0.92, baseW = Math.min(120, (p.w * 0.5) / frontScale);
    var stepX = (p.w - baseW * frontScale - 30) / Math.max(1, n - 1), stepY = 26 / Math.max(1, n - 1);
    var heights = [];
    items.forEach(function (item, i) {
      var f = factor(i), w = baseW * f, h = (item.value / max) * baseH * f, side = 14 * f;
      var x = p.x + 30 + i * stepX, bottom = p.y + p.h - 26 + i * stepY, y = bottom - h;
      var color = i === n - 1 ? s.accent : s.main, opacity = i === n - 1 ? 1 : 0.6 + 0.2 * (i / Math.max(1, n - 1));
      heights.push(h);
      // 側面(左)と上面
      var sideD = 'M' + x + ',' + y + 'L' + (x - side) + ',' + (y - side * 0.5) + 'L' + (x - side) + ',' + (bottom - side * 0.5) + 'L' + x + ',' + bottom + 'Z';
      var topD = 'M' + x + ',' + y + 'L' + (x - side) + ',' + (y - side * 0.5) + 'L' + (x + w - side) + ',' + (y - side * 0.5) + 'L' + (x + w) + ',' + y + 'Z';
      [sideD, topD].forEach(function (d, idx) {
        p.svg.appendChild(el('path', { d: d, fill: s.bg }));
        p.svg.appendChild(el('path', { d: d, fill: color, 'fill-opacity': opacity }));
        p.svg.appendChild(el('path', { d: d, fill: '#000', 'fill-opacity': idx === 0 ? 0.3 : 0.12 }));
      });
      p.svg.appendChild(el('rect', { x: x, y: y, width: w, height: h, fill: s.bg }));
      p.svg.appendChild(el('rect', { x: x, y: y, width: w, height: h, fill: color, 'fill-opacity': opacity, stroke: s.bg, 'stroke-width': 1 }));
      p.svg.appendChild(el('text', {
        x: x + w / 2, y: y + h * 0.42, 'text-anchor': 'middle', fill: '#fff', 'font-weight': 700,
        'font-size': (p.tick + 5) * f, text: fmt(item.value),
      }));
      p.svg.appendChild(el('text', {
        x: x + w / 2, y: bottom - 10 * f, 'text-anchor': 'middle', fill: '#fff', 'font-size': (p.tick + 1) * f, text: item.label,
      }));
    });
    return { svg: p.svg, measure: {
      a: items[n - 1].label, b: items[0].label,
      visual: fmt(heights[n - 1] / (heights[0] || 1), 2), actual: fmt(items[n - 1].value / (items[0].value || 1), 2),
      area: fmt(Math.pow(frontScale, 2) * (items[n - 1].value / (items[0].value || 1)), 1),
    } };
  }

  // ---- 手口 5: 恣意的な分類(区切り幅をそろえない) ---------------------------
  // 若い側から 2 つずつ年代をまとめ、残りは 1 つずつのまま並べる。
  function category(o) {
    var items = o.data.items, s = o.style;
    var p = frame(o);
    var merge = o.deceptive ? Math.max(0, Math.min(Math.floor(items.length / 2), o.params.merge)) : 0;
    var bars = [];
    for (var g = 0; g < merge; g++) {
      var a = items[g * 2], b = items[g * 2 + 1];
      bars.push({ label: a.label + '〜' + b.label, value: a.value + b.value, color: s.accent, merged: true });
    }
    items.slice(merge * 2).forEach(function (item) {
      bars.push({ label: item.label, value: item.value, color: s.main, opacity: 0.8 });
    });
    var max = niceMax(Math.max.apply(null, bars.map(function (bar) { return bar.value; })));
    var scale = function (v) { return p.y + p.h - (v / max) * p.h; };

    yAxis(p, o, scale, ticks(0, max, 5), 'left', o.t('category_unit'));
    baseline(p, o);
    columns(p, o, bars, scale);

    var merged = bars.filter(function (bar) { return bar.merged; });
    var biggest = merged.reduce(function (x, y) { return y.value > x.value ? y : x; }, merged[0] || { label: '', value: 0 });
    var single = items.reduce(function (x, y) { return y.value > x.value ? y : x; });
    return { svg: p.svg, measure: {
      g: biggest.label, sum: fmt(biggest.value), avg: fmt(biggest.value / 2), top: single.label, topv: fmt(single.value),
    } };
  }

  var RENDERERS = { dual: dual, truncate: truncate, interval: interval, ratio: ratio, bars3d: bars3d, pie3d: pie3d, category: category };

  window.Charts = {
    // 画面に並べる 5 つの手口。手口 3 と 4 は記事の例に合わせて 2 種類の描き方(variants)を持つ。
    ORDER: ['dual', 'truncate', 'interval', 'threeD', 'category'],
    VARIANTS: { interval: ['ratio', 'interval'], threeD: ['bars3d', 'pie3d'] },
    DATASETS: ['dual', 'truncate', 'interval', 'ratio', 'bars3d', 'pie3d', 'category'],
    render: function (kind, options) { return RENDERERS[kind](options); },
  };
})();
