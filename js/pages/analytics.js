/*
  Analytics - the figures a monthly report is written from.

  The chart is inline SVG, drawn by hand. That is not stubbornness about
  dependencies: one line and one filled area on a fixed 0-100 axis is about
  forty lines of path arithmetic, and a charting library would be several
  hundred kilobytes to draw it, plus a second set of colour and theme rules to
  keep in step with the tokens.

  The y-axis is pinned to 0-100 rather than fitted to the data. An auto-fitted
  axis makes 99.2% and 97.8% look like a cliff, which is exactly the wrong
  impression to give someone deciding whether a site needs attention.
*/
window.SM = window.SM || {};
SM.pages = SM.pages || {};

SM.pages.analytics = (function () {
  'use strict';

  var html = SM.dom.html;
  var raw = SM.dom.raw;

  var W = 960, H = 200, PAD_L = 34, PAD_R = 8, PAD_T = 10, PAD_B = 22;

  function mount(ctx) {
    var root = ctx.view;

    root.innerHTML = html`
      <div id="a-header"></div>
      <div class="page-body">
        <div class="card surface-card" id="a-filters"></div>
        <div class="tiles-4" id="a-tiles"></div>
        <div class="card surface-card" id="a-chart"></div>
        <div class="grid md:grid-cols-2 gap-3" id="a-breakdown"></div>
        <div class="card surface-card" id="a-outages"></div>
      </div>`;

    var elHeader = SM.dom.qs('#a-header', root);
    var elFilters = SM.dom.qs('#a-filters', root);
    var elTiles = SM.dom.qs('#a-tiles', root);
    var elChart = SM.dom.qs('#a-chart', root);
    var elBreak = SM.dom.qs('#a-breakdown', root);
    var elOutages = SM.dom.qs('#a-outages', root);

    /* ---------- state ---------- */

    function defaults() {
      var today = new Date();
      var start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
      return { from: SM.fmt.isoDate(start), to: SM.fmt.isoDate(today) };
    }

    function readState() {
      var p = SM.router.currentParams();
      var d = defaults();
      return {
        from: p.from || d.from,
        to: p.to || d.to,
        systemId: p.system ? parseInt(p.system, 10) : null,
        isDefault: !p.from && !p.to && !p.system
      };
    }

    /* ---------- render ---------- */

    function update() {
      var state = readState();
      var data = SM.analytics.compute({
        from: state.from, to: state.to, systemTypeId: state.systemId
      });

      elHeader.innerHTML = SM.ui.PageHeader({
        title: 'Analytics',
        desc: 'Uptime, latency and outages over a date range — the figures a ' +
              'monthly report is written from'
      }).__html;

      elFilters.innerHTML = filterCard(state);

      if (!data.totals.checks) {
        elTiles.innerHTML = '';
        elChart.innerHTML = SM.ui.Empty({
          icon: 'bar-chart-3',
          title: 'No checks in this range',
          desc: 'Widen the dates, or run a sweep from the Dashboard.'
        }).__html;
        elBreak.innerHTML = '';
        elOutages.innerHTML = '';
        return;
      }

      elTiles.innerHTML =
        SM.ui.StatTile({
          label: 'Overall uptime',
          value: SM.fmt.percent(data.totals.uptimePct, 2),
          tone: SM.analytics.uptimeTone(data.totals.uptimePct),
          hint: SM.fmt.plural(data.totals.checks, 'check')
        }).__html +
        SM.ui.StatTile({
          label: 'Outages',
          value: data.outages.length,
          tone: data.ongoing ? 'down' : null,
          hint: data.ongoing
            ? SM.fmt.plural(data.ongoing, 'still ongoing', 'still ongoing')
            : 'all recovered'
        }).__html +
        SM.ui.StatTile({
          label: 'Mean time to recovery',
          value: data.mttrMs == null ? '--' : SM.fmt.duration(data.mttrMs),
          hint: data.mttrMs == null
            ? 'nothing recovered in range'
            : 'across ' + SM.fmt.plural(data.outages.length - data.ongoing, 'outage')
        }).__html +
        SM.ui.StatTile({
          label: 'Average latency',
          value: SM.fmt.latency(data.totals.avgLatencyMs),
          hint: 'successful checks only'
        }).__html;

      elChart.innerHTML = html`
        <div class="card-head">
          <h2 class="card-title">Daily uptime</h2>
          <p class="card-desc">Percentage of checks that passed, per day</p>
        </div>
        <div class="card-body">
          ${raw(chartSvg(data.daily))}
          <p class="chart-caption" id="a-caption">
            ${data.daily.length
              ? 'Hover the chart to read a day.'
              : 'Not enough days to draw.'}
          </p>
        </div>`;

      elBreak.innerHTML =
        barsCard('Uptime by system', 'Worst first', data.bySystem) +
        barsCard('Uptime by site', 'Worst first', data.bySite);

      elOutages.innerHTML = outagesTable(data.outages);

      bindChart(data.daily);
    }

    function filterCard(state) {
      var systems = SM.queries.systemTypes({ includeInactive: true });
      return html`
        <div class="card-body pt-5">
          <div class="filters">
            ${SM.ui.Field({ name: 'from', label: 'From', type: 'date', value: state.from,
                            max: state.to, act: 'filter-from' })}
            ${SM.ui.Field({ name: 'to', label: 'To', type: 'date', value: state.to,
                            min: state.from, act: 'filter-to' })}
            ${SM.ui.Select({ name: 'system', label: 'System', value: state.systemId || '',
                             placeholder: 'All systems', act: 'filter-system',
                             options: systems.map(function (s) { return [s.id, s.name]; }) })}
            <div class="filters-reset">
              ${SM.ui.Button({ label: 'Reset', icon: 'rotate-ccw', variant: 'secondary',
                               act: 'reset-filters', disabled: state.isDefault })}
            </div>
          </div>
        </div>`;
    }

    /* ---------- the chart ---------- */

    function xAt(index, count) {
      if (count <= 1) return PAD_L + (W - PAD_L - PAD_R) / 2;
      return PAD_L + (index / (count - 1)) * (W - PAD_L - PAD_R);
    }

    function yAt(pct) {
      return PAD_T + (1 - (pct / 100)) * (H - PAD_T - PAD_B);
    }

    function chartSvg(series) {
      if (!series.length) return '';

      var grid = '';
      var labels = '';
      [0, 25, 50, 75, 100].forEach(function (pct) {
        var y = yAt(pct);
        grid += '<line class="chart-grid" x1="' + PAD_L + '" y1="' + y.toFixed(1) +
          '" x2="' + (W - PAD_R) + '" y2="' + y.toFixed(1) + '"/>';
        labels += '<text class="chart-axis" x="' + (PAD_L - 6) + '" y="' +
          (y + 3.5).toFixed(1) + '" text-anchor="end">' + pct + '</text>';
      });

      var line = '';
      var area = '';
      for (var i = 0; i < series.length; i++) {
        var pct = series[i].uptimePct == null ? 0 : series[i].uptimePct;
        var x = xAt(i, series.length).toFixed(1);
        var y = yAt(pct).toFixed(1);
        line += (i ? ' L' : 'M') + x + ' ' + y;
      }
      area = 'M' + xAt(0, series.length).toFixed(1) + ' ' + yAt(0).toFixed(1) +
        ' L' + line.slice(1) +
        ' L' + xAt(series.length - 1, series.length).toFixed(1) + ' ' + yAt(0).toFixed(1) + ' Z';

      /* First, middle and last day only - a label per day is unreadable. */
      var ticks = '';
      [0, Math.floor((series.length - 1) / 2), series.length - 1]
        .filter(function (v, idx, arr) { return arr.indexOf(v) === idx; })
        .forEach(function (index) {
          ticks += '<text class="chart-axis" x="' + xAt(index, series.length).toFixed(1) +
            '" y="' + (H - 6) + '" text-anchor="' +
            (index === 0 ? 'start' : (index === series.length - 1 ? 'end' : 'middle')) +
            '">' + SM.dom.esc(SM.fmt.dateLabel(series[index].day)) + '</text>';
        });

      return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" ' +
        'preserveAspectRatio="none" role="img" ' +
        'aria-label="Daily uptime percentage over the selected range" id="a-svg">' +
        grid + labels + ticks +
        '<path class="chart-area" d="' + area + '"/>' +
        '<path class="chart-line" d="' + line + '"/>' +
        '<line class="chart-cursor" id="a-cursor" x1="0" y1="' + PAD_T +
        '" x2="0" y2="' + (H - PAD_B) + '" style="display:none"/>' +
        '<circle class="chart-dot" id="a-dot" r="4" cx="0" cy="0" style="display:none"/>' +
        /* One transparent rectangle rather than a listener per point. */
        '<rect id="a-hit" x="' + PAD_L + '" y="' + PAD_T + '" width="' +
        (W - PAD_L - PAD_R) + '" height="' + (H - PAD_T - PAD_B) +
        '" fill="transparent" style="cursor:crosshair"/>' +
        '</svg>';
    }

    /*
      Hit-testing by inverting the same scale used to draw, so the crosshair
      cannot drift out of step with the line.
    */
    function bindChart(series) {
      if (!series.length) return;
      var svg = SM.dom.qs('#a-svg', elChart);
      var hit = SM.dom.qs('#a-hit', elChart);
      var cursor = SM.dom.qs('#a-cursor', elChart);
      var dot = SM.dom.qs('#a-dot', elChart);
      var caption = SM.dom.qs('#a-caption', elChart);
      if (!svg || !hit) return;

      function onMove(event) {
        var box = svg.getBoundingClientRect();
        var xView = ((event.clientX - box.left) / box.width) * W;
        var span = W - PAD_L - PAD_R;
        var ratio = Math.max(0, Math.min(1, (xView - PAD_L) / span));
        var index = Math.round(ratio * (series.length - 1));
        var point = series[index];

        var x = xAt(index, series.length);
        var y = yAt(point.uptimePct == null ? 0 : point.uptimePct);
        cursor.setAttribute('x1', x); cursor.setAttribute('x2', x);
        cursor.style.display = '';
        dot.setAttribute('cx', x); dot.setAttribute('cy', y);
        dot.style.display = '';

        caption.textContent = SM.fmt.dateLabel(point.day) + ' · ' +
          SM.fmt.percent(point.uptimePct, 1) + ' of ' +
          SM.fmt.plural(point.checks, 'check') + ' passed';
      }

      function onLeave() {
        cursor.style.display = 'none';
        dot.style.display = 'none';
        caption.textContent = 'Hover the chart to read a day.';
      }

      hit.addEventListener('mousemove', onMove, { signal: ctx.signal });
      hit.addEventListener('mouseleave', onLeave, { signal: ctx.signal });
      /* Touch gets the same readout from a tap. */
      hit.addEventListener('touchstart', function (event) {
        onMove(event.touches[0]);
      }, { signal: ctx.signal, passive: true });
    }

    /* ---------- breakdowns ---------- */

    function barsCard(title, subtitle, rows) {
      var bars = rows.map(function (row) {
        return html`
          <div class="bar-row" data-sys="${row.color}">
            <span class="bar-name" title="${row.name}">${row.name}</span>
            <span class="bar-track">
              <span class="bar-fill" style="width:${row.uptimePct.toFixed(2)}%"></span>
            </span>
            <span class="bar-value">${SM.fmt.percent(row.uptimePct, 1)}</span>
          </div>`;
      }).join('');

      return html`
        <section class="card surface-card">
          <div class="card-head">
            <h2 class="card-title">${title}</h2>
            <p class="card-desc">${subtitle}</p>
          </div>
          <div class="card-body">
            <div class="bars">${raw(bars)}</div>
          </div>
        </section>`;
    }

    /* ---------- outages ---------- */

    function outagesTable(outages) {
      var shown = outages.slice(0, 200);
      var table = SM.ui.Table({
        columns: [
          { key: 'site', label: 'LHIO', primary: true,
            cell: function (row) { return SM.dom.esc(row.location_name); } },
          { key: 'system', label: 'System',
            cell: function (row) {
              return SM.ui.SystemBadge({
                system_type_name: row.system_type_name,
                system_type_color: row.system_type_color
              }).__html;
            } },
          { key: 'started', label: 'Started',
            cell: function (row) {
              return SM.fmt.dateLabel(row.started) + ' ' + SM.fmt.timeLabel(row.started);
            } },
          { key: 'recovered', label: 'Recovered',
            cell: function (row) {
              return row.ongoing
                ? '<span class="flex items-center gap-1.5 text-down">' +
                  '<span class="badge-dot"></span>Still down</span>'
                : SM.fmt.dateLabel(row.recovered) + ' ' + SM.fmt.timeLabel(row.recovered);
            } },
          { key: 'duration', label: 'Duration', num: true,
            cell: function (row) { return SM.fmt.duration(row.durationMs); } },
          { key: 'failed', label: 'Failed checks', num: true,
            cell: function (row) { return String(row.failedChecks); } }
        ],
        rows: shown,
        empty: 'No outages in this range — every check passed.'
      }).__html;

      return html`
        <div class="card-head">
          <h2 class="card-title">Outages</h2>
          <p class="card-desc">Longest first; anything still down is listed above the rest</p>
        </div>
        ${raw(table)}
        ${outages.length > shown.length
          ? raw('<p class="pager">Showing the first ' + shown.length + ' of ' +
                outages.length + ' outages. Narrow the range to see the rest.</p>')
          : ''}`;
    }

    /* ---------- events ---------- */

    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="filter-from"]', function (e, node) {
      SM.router.patchParams({ from: node.value || null });
    }));
    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="filter-to"]', function (e, node) {
      SM.router.patchParams({ to: node.value || null });
    }));
    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="filter-system"]', function (e, node) {
      SM.router.patchParams({ system: node.value || null });
    }));
    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="reset-filters"]', function () {
      SM.router.setParams({});
    }));

    ctx.onCleanup(SM.store.subscribe(['checks', 'locations', 'system_types'], update,
      { signal: ctx.signal }));

    update();
    return { onParams: update };
  }

  return { mount: mount };
})();
