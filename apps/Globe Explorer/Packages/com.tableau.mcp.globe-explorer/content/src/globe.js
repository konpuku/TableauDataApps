// ============================================================================
// globe.js — Canvas 2D + d3-geo の正射図法で描く地球儀。WebGL は使わない。
//
//   var globe = Globe.create(canvas, { onHover, onSelect });
//   globe.setPoints([{ id, lat, lon, mag, depth, ... }]);
//
// ドラッグで回転、ホイール/ボタンで拡大縮小。裏側の点は d3 の clipAngle が落とす。
// 色は深さ(単一色相の濃淡)、大きさはマグニチュード。
// ============================================================================
(function () {
  'use strict';

  // 深さ(km)の区切りと、浅い=淡い → 深い=濃い の単一色相ランプ。
  var DEPTH_STOPS = [10, 35, 70, 150, 300];
  var DEPTH_COLORS = ['#b7d3f6', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'];

  function depthColor(depth) {
    for (var i = 0; i < DEPTH_STOPS.length; i++) {
      if (depth < DEPTH_STOPS[i]) return DEPTH_COLORS[i];
    }
    return DEPTH_COLORS[DEPTH_COLORS.length - 1];
  }

  /** マグニチュード → 半径(px)。面積がおおよそエネルギー感に沿うよう指数で伸ばす。 */
  function radius(mag, scale) {
    var m = Math.max(0, mag);
    return Math.max(1.6, (1.4 + Math.pow(1.62, m) * 0.9) * scale);
  }

  function create(canvas, handlers) {
    var ctx = canvas.getContext('2d');
    var world = window.WORLD_110M;
    var land = topojson.feature(world, world.objects.land);
    var borders = topojson.mesh(world, world.objects.countries, function (a, b) { return a !== b; });
    var graticule = d3.geoGraticule10();
    var sphere = { type: 'Sphere' };

    var projection = d3.geoOrthographic().clipAngle(90).precision(0.4);
    var path = d3.geoPath(projection, ctx);

    var state = {
      width: 0, height: 0, dpr: 1,
      rotate: [-150, -20, 0], // 太平洋を正面に
      zoom: 1,
      points: [],
      drawn: [], // 直近のフレームで表側に描いた点 { x, y, r, p }
      hover: null,
      selected: null,
      spinning: true,
      dragging: false,
    };
    var frame = null;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      state.dpr = window.devicePixelRatio || 1;
      state.width = Math.max(120, rect.width);
      state.height = Math.max(120, rect.height);
      canvas.width = Math.round(state.width * state.dpr);
      canvas.height = Math.round(state.height * state.dpr);
      schedule();
    }

    function schedule() {
      if (frame == null) frame = requestAnimationFrame(draw);
    }

    function draw() {
      frame = null;
      var w = state.width, h = state.height;
      var usable = h - 40; // 下端の凡例ぶんを空ける
      var base = Math.min(w, usable) / 2 - 10;
      projection.translate([w / 2, usable / 2 + 4]).scale(base * state.zoom).rotate(state.rotate);

      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      ctx.beginPath(); path(sphere);
      ctx.fillStyle = '#eef3f8'; ctx.fill();

      ctx.beginPath(); path(graticule);
      ctx.strokeStyle = 'rgba(11,11,11,0.07)'; ctx.lineWidth = 1; ctx.stroke();

      ctx.beginPath(); path(land);
      ctx.fillStyle = '#dcdbd3'; ctx.fill();

      ctx.beginPath(); path(borders);
      ctx.strokeStyle = '#fcfcfb'; ctx.lineWidth = 0.6; ctx.stroke();

      ctx.beginPath(); path(sphere);
      ctx.strokeStyle = '#c3c2b7'; ctx.lineWidth = 1; ctx.stroke();

      // 点: 表側だけ。小さい順に描き、大きい地震を上に載せる(points は mag 昇順で保持)。
      var center = [-state.rotate[0], -state.rotate[1]];
      var scale = Math.sqrt(state.zoom);
      var drawn = [];
      for (var i = 0; i < state.points.length; i++) {
        var p = state.points[i];
        if (d3.geoDistance([p.lon, p.lat], center) > Math.PI / 2 - 0.02) continue;
        var xy = projection([p.lon, p.lat]);
        if (!xy) continue;
        var r = radius(p.mag, scale);
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], r, 0, Math.PI * 2);
        ctx.globalAlpha = 0.86;
        ctx.fillStyle = depthColor(p.depth);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (r >= 3) { // 重なっても輪郭が読めるよう、面色のリングで分ける
          ctx.strokeStyle = '#fcfcfb'; ctx.lineWidth = 1; ctx.stroke();
        }
        drawn.push({ x: xy[0], y: xy[1], r: r, p: p });
      }
      state.drawn = drawn;

      [state.selected, state.hover].forEach(function (p, idx) {
        if (!p) return;
        var hit = null;
        for (var j = 0; j < drawn.length; j++) if (drawn[j].p === p) { hit = drawn[j]; break; }
        if (!hit) return;
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, hit.r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = '#0b0b0b'; ctx.lineWidth = idx === 0 ? 2 : 1.25; ctx.stroke();
      });

      if (state.spinning && !state.dragging) {
        state.rotate = [state.rotate[0] + 0.12, state.rotate[1], 0];
        schedule();
      }
    }

    /** ポインタ位置に最も近い点(当たり判定は見た目より一回り大きく)。 */
    function pick(event) {
      var rect = canvas.getBoundingClientRect();
      var x = event.clientX - rect.left, y = event.clientY - rect.top;
      var best = null, bestD = Infinity;
      for (var i = state.drawn.length - 1; i >= 0; i--) {
        var d = state.drawn[i];
        var dist = Math.hypot(d.x - x, d.y - y);
        if (dist <= d.r + 5 && dist < bestD) { best = d.p; bestD = dist; }
      }
      return best;
    }

    var last = null, moved = false;
    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      last = [e.clientX, e.clientY]; moved = false; state.dragging = true;
    });
    canvas.addEventListener('pointermove', function (e) {
      if (state.dragging && last) {
        var dx = e.clientX - last[0], dy = e.clientY - last[1];
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        var k = 0.28 / state.zoom;
        state.rotate = [
          state.rotate[0] + dx * k,
          Math.max(-89, Math.min(89, state.rotate[1] - dy * k)),
          0,
        ];
        last = [e.clientX, e.clientY];
        handlers.onHover(null, e);
        schedule();
        return;
      }
      var p = pick(e);
      if (p !== state.hover) { state.hover = p; schedule(); }
      canvas.style.cursor = p ? 'pointer' : 'grab';
      handlers.onHover(p, e);
    });
    canvas.addEventListener('pointerup', function (e) {
      state.dragging = false; last = null;
      if (!moved) {
        state.selected = pick(e);
        handlers.onSelect(state.selected);
      }
      schedule();
    });
    canvas.addEventListener('pointerleave', function (e) {
      state.hover = null; handlers.onHover(null, e); schedule();
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });

    function zoomBy(factor) {
      state.zoom = Math.max(0.8, Math.min(8, state.zoom * factor));
      schedule();
    }

    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize);
    resize();

    return {
      setPoints: function (points) {
        state.points = points.slice().sort(function (a, b) { return a.mag - b.mag; });
        if (state.selected && state.points.indexOf(state.selected) < 0) state.selected = null;
        state.hover = null;
        schedule();
      },
      setSpinning: function (on) { state.spinning = on; schedule(); },
      isSpinning: function () { return state.spinning; },
      zoomBy: zoomBy,
      /** 指定地点を正面に向ける。 */
      focus: function (lon, lat, zoom) {
        state.spinning = false;
        state.rotate = [-lon, -lat, 0];
        if (zoom) state.zoom = zoom;
        schedule();
      },
      resetZoom: function () { state.zoom = 1; schedule(); },
    };
  }

  window.Globe = {
    create: create,
    DEPTH_STOPS: DEPTH_STOPS,
    DEPTH_COLORS: DEPTH_COLORS,
    depthColor: depthColor,
  };
})();
