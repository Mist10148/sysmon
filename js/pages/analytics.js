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
        source: p.source === 'live' || p.source === 'sim' ? p.source : null,
        /* Comparison is on only when it has both ends; half a range is noise. */
        cfrom: p.cfrom || null,
        cto: p.cto || null,
        isDefault: !p.from && !p.to && !p.system && !p.source && !p.cfrom && !p.cto
      };
    }

    /* ---------- render ---------- */

    function update() {
      var state = readState();
      var data = SM.analytics.compute({
        from: state.from, to: state.to, systemTypeId: state.systemId,
        source: state.source
      });

      /* Same system and same source, so only the dates differ. */
      var compare = state.cfrom && state.cto
        ? SM.analytics.compute({
            from: state.cfrom, to: state.cto, systemTypeId: state.systemId,
            source: state.source
          })
        : null;

      elHeader.innerHTML = SM.ui.PageHeader({
        title: 'Analytics',
        desc: 'Uptime, latency and outages over a date range — the figures a ' +
              'monthly report is written from',
        provenance: provenanceNote(data.provenance, state.source)
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
          hint: compare
            ? deltaNote(data.totals.uptimePct, compare.totals.uptimePct, 'pct')
            : SM.fmt.plural(data.totals.checks, 'check')
        }).__html +
        SM.ui.StatTile({
          label: 'Outages',
          value: data.outages.length,
          tone: data.ongoing ? 'down' : null,
          hint: compare
            ? deltaNote(data.outages.length, compare.outages.length, 'count')
            : (data.ongoing
                ? SM.fmt.plural(data.ongoing, 'still ongoing', 'still ongoing')
                : 'all recovered')
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
          hint: compare
            ? deltaNote(data.totals.avgLatencyMs, compare.totals.avgLatencyMs, 'ms')
            : 'successful checks only'
        }).__html;

      elChart.innerHTML = html`
        <div class="card-head">
          <h2 class="card-title">Daily uptime</h2>
          <p class="card-desc">Percentage of checks that passed, per day</p>
        </div>
        <div class="card-body">
          ${raw(chartSvg(data.daily, compare ? compare.daily : null))}
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

      bindChart(data.daily, compare);
    }

    function filterCard(state) {
      var systems = SM.queries.systemTypes({ includeInactive: true });
      return html`
        <div class="card-body pt-5">
          <div class="filters filters-6">
            ${SM.ui.Field({ name: 'from', label: 'From', type: 'date', value: state.from,
                            max: state.to, act: 'filter-from' })}
            ${SM.ui.Field({ name: 'to', label: 'To', type: 'date', value: state.to,
                            min: state.from, act: 'filter-to' })}
            ${SM.ui.Select({ name: 'system', label: 'System', value: state.systemId || '',
                             placeholder: 'All systems', act: 'filter-system',
                             options: systems.map(function (s) { return [s.id, s.name]; }) })}
            ${SM.ui.Select({ name: 'source', label: 'Source', value: state.source || '',
                             placeholder: 'Measured and simulated', act: 'filter-source',
                             options: [['live', 'Measured only'], ['sim', 'Simulated only']] })}
            <div class="filters-reset">
              ${SM.ui.Button({ label: 'Reset', icon: 'rotate-ccw', variant: 'secondary',
                               act: 'reset-filters', disabled: state.isDefault })}
            </div>
          </div>

          <div class="compare-row">
            ${SM.ui.Button({
              label: state.cfrom && state.cto ? 'Stop comparing' : 'Compare with another range',
              icon: 'bar-chart-3', variant: 'ghost', size: 'sm', act: 'toggle-compare'
            })}
            ${state.cfrom && state.cto ? raw(html`
              <div class="filters">
                ${SM.ui.Field({ name: 'cfrom', label: 'Compare from', type: 'date',
                                value: state.cfrom, max: state.cto, act: 'filter-cfrom' })}
                ${SM.ui.Field({ name: 'cto', label: 'Compare to', type: 'date',
                                value: state.cto, min: state.cfrom, act: 'filter-cto' })}
                <p class="compare-note">
                  Lined up by day one, not by date — a shorter range simply stops early.
                </p>
              </div>`) : ''}
          </div>
        </div>`;
    }

    /*
      Where these figures came from.

      The counts are taken over the range *before* the source filter, so the
      sentence stays true while the page is showing only one source: a month
      that was half measured reads as half measured, rather than averaging the
      two together and saying nothing about either.

      Wording follows the Dashboard's note, so the same fact is phrased the
      same way in both places.
    */
    function provenanceNote(counted, source) {
      if (!counted || !counted.all) return '';

      if (source === 'live') {
        return 'measured only · ' + counted.live + ' of ' + counted.all + ' checks';
      }
      if (source === 'sim') {
        return 'simulated only · ' + counted.sim + ' of ' + counted.all + ' checks';
      }
      if (!counted.sim) return 'all measured';
      if (counted.sim === counted.all) return 'simulated, not measured';
      return counted.sim + ' of ' + counted.all + ' simulated';
    }

    /*
      A tile's change against the comparison range.

      Latency and outages are better when they fall, uptime when it rises, so
      the arrow is chosen per kind rather than from the sign.
    */
    function deltaNote(now, then, kind) {
      if (now == null || then == null) return 'no comparison';

      var diff = now - then;
      /*
        The threshold is the precision the value is printed at, not an epsilon.
        Latency shows whole milliseconds, so a 0.4ms difference has to read as
        no change rather than as "0 ms" with an arrow in front of it.
      */
      var floor = kind === 'ms' ? 0.5 : kind === 'count' ? 0.5 : 0.005;
      if (Math.abs(diff) < floor) return 'no change';

      var arrow = diff > 0 ? '↑ ' : '↓ ';
      var size = kind === 'pct' ? SM.fmt.percent(Math.abs(diff), 2)
        : kind === 'ms' ? SM.fmt.latency(Math.abs(diff))
        : String(Math.abs(diff));
      return arrow + size + ' vs comparison';
    }

    /* ---------- the chart ---------- */

    function xAt(index, count) {
      if (count <= 1) return PAD_L + (W - PAD_L - PAD_R) / 2;
      return PAD_L + (index / (count - 1)) * (W - PAD_L - PAD_R);
    }

    function yAt(pct) {
      return PAD_T + (1 - (pct / 100)) * (H - PAD_T - PAD_B);
    }

    /*
      One series to its two paths. Pulled out of chartSvg so a comparison range
      can have its own pair: the area used to be built by slicing the line
      string, which quietly made the two inseparable.

      `count` is passed in rather than taken from the series, so that when two
      ranges of different lengths are drawn together they share one horizontal
      scale instead of each stretching to fill the width.
    */
    function pathsFor(series, count) {
      var line = '';
      for (var i = 0; i < series.length; i++) {
        var pct = series[i].uptimePct == null ? 0 : series[i].uptimePct;
        line += (i ? ' L' : 'M') + xAt(i, count).toFixed(1) + ' ' + yAt(pct).toFixed(1);
      }
      var area = 'M' + xAt(0, count).toFixed(1) + ' ' + yAt(0).toFixed(1) +
        ' L' + line.slice(1) +
        ' L' + xAt(series.length - 1, count).toFixed(1) + ' ' + yAt(0).toFixed(1) + ' Z';
      return { line: line, area: area };
    }

    function chartSvg(series, compare) {
      if (!series.length) return '';

      /*
        Both ranges are laid out against whichever is longer, and a shorter
        comparison simply stops early. Resampling one onto the other would put
        a number under a date it did not come from.
      */
      var count = Math.max(series.length, compare ? compare.length : 0);

      var grid = '';
      var labels = '';
      [0, 25, 50, 75, 100].forEach(function (pct) {
        var y = yAt(pct);
        grid += '<line class="chart-grid" x1="' + PAD_L + '" y1="' + y.toFixed(1) +
          '" x2="' + (W - PAD_R) + '" y2="' + y.toFixed(1) + '"/>';
        labels += '<text class="chart-axis" x="' + (PAD_L - 6) + '" y="' +
          (y + 3.5).toFixed(1) + '" text-anchor="end">' + pct + '</text>';
      });

      var main = pathsFor(series, count);
      var other = compare && compare.length ? pathsFor(compare, count) : null;

      /* First, middle and last day only - a label per day is unreadable. */
      var ticks = '';
      [0, Math.floor((series.length - 1) / 2), series.length - 1]
        .filter(function (v, idx, arr) { return arr.indexOf(v) === idx; })
        .forEach(function (index) {
          ticks += '<text class="chart-axis" x="' + xAt(index, count).toFixed(1) +
            '" y="' + (H - 6) + '" text-anchor="' +
            (index === 0 ? 'start' : (index === series.length - 1 ? 'end' : 'middle')) +
            '">' + SM.dom.esc(SM.fmt.dateLabel(series[index].day)) + '</text>';
        });

      return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" ' +
        'preserveAspectRatio="none" role="img" ' +
        'aria-label="Daily uptime percentage over the selected range" id="a-svg">' +
        grid + labels + ticks +
        /* The comparison goes underneath, so the current range reads on top. */
        (other ? '<path class="chart-line-compare" d="' + other.line + '"/>' : '') +
        '<path class="chart-area" d="' + main.area + '"/>' +
        '<path class="chart-line" d="' + main.line + '"/>' +
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
    function bindChart(series, compare) {
      if (!series.length) return;
      var other = compare ? compare.daily : null;
      var count = Math.max(series.length, other ? other.length : 0);
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
        var index = Math.round(ratio * (count - 1));
        var point = series[Math.min(index, series.length - 1)];

        var x = xAt(Math.min(index, series.length - 1), count);
        var y = yAt(point.uptimePct == null ? 0 : point.uptimePct);
        cursor.setAttribute('x1', x); cursor.setAttribute('x2', x);
        cursor.style.display = '';
        dot.setAttribute('cx', x); dot.setAttribute('cy', y);
        dot.style.display = '';

        var text = SM.fmt.dateLabel(point.day) + ' · ' +
          SM.fmt.percent(point.uptimePct, 1) + ' of ' +
          SM.fmt.plural(point.checks, 'check') + ' passed';

        /*
          The comparison point is the one at the same position in its own
          range, not the same date - that is what "aligned by day one" means,
          and the caption names its date so it cannot be mistaken for this one.
        */
        if (other && other[index]) {
          text += '  ·  vs ' + SM.fmt.dateLabel(other[index].day) + ' ' +
            SM.fmt.percent(other[index].uptimePct, 1);
        }
        caption.textContent = text;
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
    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="filter-source"]', function (e, node) {
      SM.router.patchParams({ source: node.value || null });
    }));
    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="filter-cfrom"]', function (e, node) {
      SM.router.patchParams({ cfrom: node.value || null });
    }));
    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="filter-cto"]', function (e, node) {
      SM.router.patchParams({ cto: node.value || null });
    }));

    /*
      Turning comparison on seeds it with the range immediately before the one
      being viewed, of the same length. That is the comparison somebody almost
      always wants, and it means the feature does something the moment it is
      switched on rather than presenting two empty date fields.
    */
    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="toggle-compare"]', function () {
      var state = readState();
      if (state.cfrom && state.cto) {
        SM.router.patchParams({ cfrom: null, cto: null });
        return;
      }
      var from = SM.fmt.parse(state.from);
      var to = SM.fmt.parse(state.to);
      if (!from || !to) return;

      var days = Math.round((to - from) / 86400000) + 1;
      var cto = new Date(from.getTime() - 86400000);
      var cfrom = new Date(cto.getTime() - (days - 1) * 86400000);
      SM.router.patchParams({ cfrom: SM.fmt.isoDate(cfrom), cto: SM.fmt.isoDate(cto) });
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
