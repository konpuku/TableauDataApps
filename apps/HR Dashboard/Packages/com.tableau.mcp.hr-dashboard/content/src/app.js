// ============================================================================
// HR Dashboard — パブリッシュ済みデータソース「Employee Master」をライブ集計する Data App。
//
// * 表示するのは集計値だけ。個人の行(氏名・個別の年収)は取得しない。
// * クエリは閲覧者本人の権限で実行される。データソース側の行レベルセキュリティが
//   あれば、同じアプリでも人によって数字が変わる。
// * 「在籍」= employment_status が Terminated 以外(既存の HR Overview の定義に合わせた)。
// ============================================================================
(function () {
  'use strict';
  var el = Kit.el, num = Kit.num, val = Kit.val;

  var SOURCE = 'Employee Master';
  var TERMINATED = 'Terminated';
  var HIRE = '#2a78d6', LEAVE = '#eb6834';
  var DIMENSIONS = [
    { key: 'department', label: '部門' },
    { key: 'office', label: '拠点' },
    { key: 'employment_type', label: '雇用形態' },
  ];

  var state = { department: null, office: null, employment_type: null };
  var ui = { selects: {} };
  var ds = null, tip = null, requestId = 0;

  // ---- フィルター ------------------------------------------------------------
  function scope(ignore) {
    return DIMENSIONS.filter(function (d) { return state[d.key] && d.key !== ignore; }).map(function (d) {
      return { field: { fieldCaption: d.key }, filterType: 'SET', values: [state[d.key]] };
    });
  }
  var ACTIVE_ONLY = { field: { fieldCaption: 'employment_status' }, filterType: 'SET', values: [TERMINATED], exclude: true };
  var LEFT_ONLY = { field: { fieldCaption: 'employment_status' }, filterType: 'SET', values: [TERMINATED] };
  var HEADCOUNT = { fieldCaption: 'employee_id', function: 'COUNTD', fieldAlias: 'People' };
  var people = function (r) { return num(val(r, 'People', 'COUNTD(employee_id)')); };

  // ---- クエリ ----------------------------------------------------------------
  function fetchSummary() {
    return Promise.all([
      Kit.query(ds, [{ fieldCaption: 'employment_status' }, HEADCOUNT], scope(), 'status'),
      Kit.query(ds, [
        { fieldCaption: 'annual_salary_jpy', function: 'AVG', fieldAlias: 'Avg' },
        { fieldCaption: 'annual_salary_jpy', function: 'MEDIAN', fieldAlias: 'Median' },
      ], scope().concat([ACTIVE_ONLY]), 'salary'),
    ]).then(function (res) {
      var total = 0, left = 0;
      res[0].forEach(function (r) {
        total += people(r);
        if (r.employment_status === TERMINATED) left += people(r);
      });
      var s = res[1][0] || {};
      return {
        active: total - left, left: left, rate: total ? left / total : 0,
        avg: num(val(s, 'Avg', 'AVG(annual_salary_jpy)')),
        median: num(val(s, 'Median', 'MEDIAN(annual_salary_jpy)')),
      };
    });
  }

  /** ある切り口(部門・拠点)ごとの在籍人数と離職率。その切り口自身の絞り込みは外して数える。 */
  function fetchBreakdown(key) {
    return Kit.query(ds, [{ fieldCaption: key }, { fieldCaption: 'employment_status' }, HEADCOUNT],
      scope(key), 'by ' + key).then(function (rows) {
      var map = Object.create(null);
      rows.forEach(function (r) {
        if (r[key] == null) return;
        var item = map[r[key]] || (map[r[key]] = { label: String(r[key]), total: 0, left: 0 });
        item.total += people(r);
        if (r.employment_status === TERMINATED) item.left += people(r);
      });
      return Object.keys(map).map(function (k) {
        var item = map[k];
        item.active = item.total - item.left;
        item.rate = item.total ? item.left / item.total : 0;
        return item;
      });
    });
  }

  function fetchGrades() {
    return Kit.query(ds, [
      { fieldCaption: 'grade' },
      { fieldCaption: 'annual_salary_jpy', function: 'AVG', fieldAlias: 'Avg' },
      HEADCOUNT,
    ], scope().concat([ACTIVE_ONLY]), 'grades').then(function (rows) {
      return rows.filter(function (r) { return r.grade != null; }).map(function (r) {
        return { label: String(r.grade), avg: num(val(r, 'Avg', 'AVG(annual_salary_jpy)')), people: people(r) };
      }).sort(function (a, b) { return a.label < b.label ? -1 : 1; });
    });
  }

  function fetchYearly(dateField, extra, label) {
    return Kit.query(ds, [
      { fieldCaption: dateField, function: 'TRUNC_YEAR', fieldAlias: 'Year' },
      HEADCOUNT,
    ], scope().concat(extra), label).then(function (rows) {
      var out = Object.create(null);
      rows.forEach(function (r) {
        var m = String(val(r, 'Year', 'TRUNC_YEAR(' + dateField + ')')).match(/^(\d{4})/);
        if (m) out[m[1]] = people(r);
      });
      return out;
    });
  }

  // 評価が「ディメンション」でも「メジャー」でも動くよう、取り方を 2 通り用意して順に試す。
  function fetchRatings() {
    var filters = scope().concat([ACTIVE_ONLY]);
    return Kit.query(ds, [{ fieldCaption: 'performance_rating' }, HEADCOUNT], filters, 'ratings')
      .catch(function () {
        return Kit.query(ds, [{ fieldCaption: 'performance_rating', binSize: 1, fieldAlias: 'performance_rating' }, HEADCOUNT],
          filters, 'ratings (bin)');
      })
      .then(function (rows) {
        return rows.filter(function (r) { return r.performance_rating != null; }).map(function (r) {
          return { label: String(r.performance_rating), people: people(r) };
        }).sort(function (a, b) { return a.label < b.label ? -1 : 1; });
      });
  }

  // ---- 描画 ------------------------------------------------------------------
  var man = function (yen) { return Math.round(yen / 1e4).toLocaleString('en-US') + ' 万円'; };
  var pct = function (r) { return (r * 100).toFixed(1) + '%'; };

  function tile(label) {
    var value = el('div', { class: 'kit-tile-value', text: '–' });
    var note = el('div', { class: 'kit-tile-note' });
    return {
      node: el('section', { class: 'kit-card' }, [el('div', { class: 'kit-tile-label', text: label }), value, note]),
      set: function (v, n) { value.textContent = v; note.textContent = n || ''; },
    };
  }

  function card(title, hint, body) {
    return el('section', { class: 'kit-card' }, [
      el('h2', {}, [title, hint ? el('small', { text: hint }) : null]),
    ].concat(body));
  }

  function toggle(key) {
    return function (label) {
      state[key] = state[key] === label ? null : label;
      ui.selects[key].value = state[key] || '';
      refresh();
    };
  }

  function section(host, promise, render) {
    return promise.then(render).catch(function (err) {
      host.replaceChildren(el('div', { class: 'kit-error', text: 'クエリに失敗: ' + Kit.errorText(err) }));
    });
  }

  function refresh() {
    var mine = ++requestId;
    var fresh = function (fn) { return function (x) { if (mine === requestId) fn(x); }; };
    var before = Kit.stats.queries, started = performance.now();
    ui.root.classList.add('is-loading');

    Promise.all([
      section(ui.tileRow, fetchSummary(), fresh(function (s) {
        ui.tActive.set(s.active.toLocaleString('en-US') + ' 名', '在籍(退職者を除く)');
        ui.tRate.set(pct(s.rate), '退職 ' + s.left.toLocaleString('en-US') + ' 名 / 全 ' + (s.active + s.left).toLocaleString('en-US') + ' 名');
        ui.tAvg.set(s.active ? man(s.avg) : '–', '在籍者の平均');
        ui.tMedian.set(s.active ? man(s.median) : '–', '在籍者の中央値');
      })),
      section(ui.dept, fetchBreakdown('department'), fresh(function (items) {
        Kit.bars(ui.dept, items.slice().sort(function (a, b) { return b.active - a.active; }).map(function (i) {
          return { label: i.label, value: i.active, title: i.label + ': 在籍 ' + i.active + ' 名' };
        }), { selected: state.department, onClick: toggle('department') });
        Kit.bars(ui.attrition, items.slice().sort(function (a, b) { return b.rate - a.rate; }).map(function (i) {
          return { label: i.label, value: i.rate, display: pct(i.rate), title: i.label + ': 退職 ' + i.left + ' / ' + i.total + ' 名' };
        }), { selected: state.department, onClick: toggle('department'), color: LEAVE });
      })),
      section(ui.office, fetchBreakdown('office'), fresh(function (items) {
        Kit.bars(ui.office, items.sort(function (a, b) { return b.active - a.active; }).map(function (i) {
          return { label: i.label, value: i.active, title: i.label + ': 在籍 ' + i.active + ' 名' };
        }), { selected: state.office, onClick: toggle('office') });
      })),
      section(ui.grades, fetchGrades(), fresh(function (items) {
        Kit.bars(ui.grades, items.map(function (i) {
          return { label: i.label, value: i.avg, display: man(i.avg), title: i.label + ': ' + i.people + ' 名の平均' };
        }));
      })),
      section(ui.flow, Promise.all([
        fetchYearly('hire_date', [], 'hires'),
        fetchYearly('termination_date', [LEFT_ONLY], 'leavers'),
      ]), fresh(function (res) {
        var years = Object.keys(Object.assign({}, res[0], res[1])).sort();
        Kit.columns(ui.flow, years.map(function (y) {
          var hired = res[0][y] || 0, left = res[1][y] || 0;
          return { label: "'" + y.slice(2), values: [hired, left], tip: [y + ' 年', '入社 ' + hired + ' 名', '退職 ' + left + ' 名'] };
        }), { colors: [HIRE, LEAVE], tip: tip, labelEvery: 1 });
      })),
      section(ui.ratings, fetchRatings(), fresh(function (items) {
        Kit.columns(ui.ratings, items.map(function (i) {
          return { label: i.label, values: [i.people], tip: ['評価 ' + i.label, i.people + ' 名'] };
        }), { tip: tip, labelEvery: 1 });
      })),
    ]).then(function () {
      if (mine !== requestId) return;
      ui.root.classList.remove('is-loading');
      ui.foot.textContent = '今回の更新: ライブクエリ ' + (Kit.stats.queries - before) + ' 本 / ' +
        Math.round(performance.now() - started) + ' ms(累計 ' + Kit.stats.queries + ' 本、キャッシュ利用 ' +
        Kit.stats.cacheHits + ' 回)· 数値は閲覧者の権限で集計されます';
    });
  }

  /** フィルターの選択肢は、絞り込みなしの値一覧を最初に一度だけ取りに行く。 */
  function loadOptions() {
    return Promise.all(DIMENSIONS.map(function (d) {
      return Kit.query(ds, [{ fieldCaption: d.key }, HEADCOUNT], [], 'options ' + d.key).then(function (rows) {
        var select = ui.selects[d.key];
        rows.map(function (r) { return r[d.key]; }).filter(function (v) { return v != null; }).sort()
          .forEach(function (v) { select.appendChild(el('option', { value: v, text: v })); });
      }).catch(function () { /* 選択肢が取れなくても本体は表示する */ });
    }));
  }

  function mount() {
    tip = Kit.tooltip();
    var controls = DIMENSIONS.map(function (d) {
      var select = el('select', { 'aria-label': d.label }, el('option', { value: '', text: 'すべて' }));
      select.addEventListener('change', function () { state[d.key] = select.value || null; refresh(); });
      ui.selects[d.key] = select;
      return el('label', { class: 'control' }, [el('span', { text: d.label }), select]);
    });
    controls.push(el('button', {
      class: 'kit-btn', type: 'button', text: 'リセット',
      onclick: function () {
        DIMENSIONS.forEach(function (d) { state[d.key] = null; ui.selects[d.key].value = ''; });
        refresh();
      },
    }));

    ui.tActive = tile('在籍人数'); ui.tRate = tile('離職率');
    ui.tAvg = tile('平均年収'); ui.tMedian = tile('年収の中央値');
    ui.tileRow = el('div', { class: 'tile-row' }, [ui.tActive.node, ui.tRate.node, ui.tAvg.node, ui.tMedian.node]);
    ['dept', 'attrition', 'office', 'grades'].forEach(function (k) { ui[k] = el('div', { class: 'kit-bars' }); });
    ui.flow = el('div'); ui.ratings = el('div');
    ui.foot = el('div', { class: 'kit-foot', text: 'Tableau に接続中…' });

    ui.root = el('div', { class: 'layout kit-mounted' }, [
      el('header', { class: 'top' }, [
        el('div', {}, [
          el('h1', { text: 'HR Dashboard' }),
          el('p', { class: 'sub', text: '人員・離職・報酬のサマリー(Employee Master をライブ集計)' }),
        ]),
        el('div', { class: 'controls' }, controls),
      ]),
      ui.tileRow,
      el('div', { class: 'grid' }, [
        card('部門別の在籍人数', 'クリックで絞り込み', ui.dept),
        card('部門別の離職率', '退職者 ÷ 全社員', ui.attrition),
        card('入社と退職の推移', '年別・人数', [
          Kit.legend([{ label: '入社', color: HIRE }, { label: '退職', color: LEAVE }]), ui.flow,
        ]),
        card('グレード別の平均年収', '在籍者', ui.grades),
        card('拠点別の在籍人数', 'クリックで絞り込み', ui.office),
        card('評価の分布', '在籍者・人数', ui.ratings),
      ]),
      ui.foot,
    ]);
    document.getElementById('app').replaceChildren(ui.root);
  }

  mount();
  Kit.boot(function (ctx) {
    ds = Kit.requireSource(ctx, SOURCE);
    loadOptions();
    refresh();
  });
})();
