/*
  Exports.

  Four things leave SysMon: the five .txt data files, a CSV of the monitoring
  form, the legacy QM.txt ping log, and a printable version of the form.

  There is no .xlsx. The previous build produced one with a Python library, and
  there is no honest way to write a real workbook from a static page - so CSV,
  which Excel opens directly, is the answer rather than a file named .xls that is
  actually HTML.

  PDF is the browser's own print dialog with a stylesheet behind it. "Save as
  PDF" is a destination in that dialog on every current browser. The one thing
  that cannot be controlled from here is the browser's own header and footer, so
  the dialog says so rather than leaving someone to wonder why a URL is printed
  at the bottom of an official form.

  Column shape follows the paper form: filtered to one system, seven columns with
  that system named in the Functional header; across systems, an eighth System
  column. Rows are oldest first, because that is the order the form is filled in.
*/
window.SM = window.SM || {};

SM.exports = (function () {
  'use strict';

  var MAX_ROWS = 20000;

  function stamp() {
    var d = new Date();
    var p = SM.fmt.pad;
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
      p(d.getHours()) + p(d.getMinutes());
  }

  /* The same rows History is showing, unpaged and oldest first. */
  function rowsFor(state) {
    var result = SM.queries.history({
      q: state.q, from: state.from, to: state.to,
      locationId: state.locationId, systemTypeId: state.systemId,
      status: state.status, sort: 'checked_at', dir: 'asc'
    });
    return result.rows;
  }

  function guard(count) {
    if (count <= MAX_ROWS) return true;
    SM.toast.warning('Too many records to export',
      'Narrow the date range: ' + count.toLocaleString() + ' rows exceeds the ' +
      MAX_ROWS.toLocaleString() + ' limit.');
    return false;
  }

  function systemName(state) {
    if (!state.systemId) return null;
    var system = SM.queries.systemById(state.systemId);
    return system ? system.name : null;
  }

  /* ---------- CSV ---------- */

  function csvCell(value) {
    var text = value == null ? '' : String(value);
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function csv(state) {
    var rows = rowsFor(state);
    if (!guard(rows.length)) return;
    if (!rows.length) { SM.toast.warning('Nothing to export'); return; }

    var single = systemName(state);
    var header = ['No.', 'LHIO', 'IP Address'];
    if (!single) header.push('System');
    header.push('Date Checked', (single ? single + ' Functional' : 'Functional'),
                'Issues Encountered', 'Status', 'Remarks');

    var lines = [header.map(csvCell).join(',')];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var cells = [i + 1, row.location_name, row.location_ip];
      if (!single) cells.push(row.system_type_name);
      cells.push(
        SM.fmt.dateLabel(row.checked_at) + ' ' + SM.fmt.timeLabel(row.checked_at),
        row.functional ? 'Yes' : 'No',
        row.issues || '',
        row.status,
        row.remarks || ''
      );
      lines.push(cells.map(csvCell).join(','));
    }

    /*
      CRLF and a byte-order mark, both for Excel: without the BOM it reads the
      file as the local codepage and mangles anything non-ASCII in a remark.
    */
    SM.dom.download('sysmon-history-' + stamp() + '.csv',
      '﻿' + lines.join('\r\n') + '\r\n', 'text/csv');
    SM.toast.success('CSV exported', SM.fmt.plural(rows.length, 'record'));
  }

  /* ---------- QM.txt ---------- */

  /*
    The format the original batch file wrote, reproduced block for block. Things
    outside SysMon read this file, which makes its layout an interface rather
    than a style choice - so it keeps its name and its shape through the rewrite.
  */
  function qm(state) {
    var rows = rowsFor(state);
    if (!guard(rows.length)) return;
    if (!rows.length) { SM.toast.warning('Nothing to export'); return; }

    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var out = [];

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var at = SM.fmt.parse(row.checked_at);
      var date = DAYS[at.getDay()] + ' ' + SM.fmt.pad(at.getMonth() + 1) + '/' +
        SM.fmt.pad(at.getDate()) + '/' + at.getFullYear() + ' ';
      var hour = at.getHours() % 12 || 12;
      var time = SM.fmt.pad(hour) + ':' + SM.fmt.pad(at.getMinutes()) + ' ' +
        (at.getHours() < 12 ? 'AM' : 'PM');

      out.push(date);
      out.push(time);
      out.push(row.location_name);
      out.push('');
      /*
        Split the transcript into its own lines rather than pushing it as one
        blob. Stored raw output uses \n; this file is joined with \r\n, so
        pushing it whole would leave a single file with mixed line endings -
        and this format is read by things outside SysMon, which is exactly
        where that bites.
      */
      var transcript = (row.raw_output || '(no output recorded)').split(/\r\n|\r|\n/);
      for (var t = 0; t < transcript.length; t++) out.push(transcript[t]);
      out.push('');
    }

    SM.dom.download('QM-' + stamp() + '.txt', out.join('\r\n') + '\r\n');
    SM.toast.success('QM.txt exported', SM.fmt.plural(rows.length, 'block'));
  }

  /* ---------- the printable form ---------- */

  function print(state) {
    var rows = rowsFor(state);
    if (!rows.length) { SM.toast.warning('Nothing to print'); return; }
    if (rows.length > 2000) {
      SM.toast.warning('That is a lot of paper',
        SM.fmt.plural(rows.length, 'record') + ' is roughly ' +
        Math.ceil(rows.length / 28) + ' pages. Narrow the date range first.');
      return;
    }

    /*
      Clear any previous report first. afterprint is not reliable everywhere -
      Safari in particular - so there is a fallback timer, and between the two a
      second print started inside that window would otherwise stack two forms and
      print both.
    */
    var stale = document.querySelectorAll('.print-report');
    for (var s = 0; s < stale.length; s++) stale[s].remove();

    var single = systemName(state);
    var host = document.createElement('div');
    host.className = 'print-report print-only';

    var header = ['No.', 'LHIO', 'IP Address'];
    if (!single) header.push('System');
    header.push('Date Checked', (single ? single + ' Functional' : 'Functional'),
                'Issues Encountered', 'Status', 'Remarks');

    var body = rows.map(function (row, index) {
      var cells = [index + 1, row.location_name, row.location_ip];
      if (!single) cells.push(row.system_type_name);
      cells.push(
        SM.fmt.dateLabel(row.checked_at) + '<br>' + SM.fmt.timeLabel(row.checked_at),
        row.functional ? '&#10003;' : '&#10007;',
        row.issues || '',
        row.status,
        row.remarks || ''
      );
      return '<tr>' + cells.map(function (c, i) {
        /* Only the two date lines carry markup; everything else is text. */
        return '<td>' + (i === (single ? 3 : 4) || i === (single ? 4 : 5)
          ? c : SM.dom.esc(c)) + '</td>';
      }).join('') + '</tr>';
    }).join('');

    host.innerHTML = SM.dom.html`
      <h1>${single ? single + ' — monitoring form' : 'System monitoring form'}</h1>
      <p class="print-meta">
        ${describeRange(state)} · ${SM.fmt.plural(rows.length, 'record')} ·
        printed ${SM.fmt.dateLabel(SM.fmt.iso())}
      </p>
      <table>
        <thead><tr>${raw(header.map(function (h) {
          return '<th>' + SM.dom.esc(h) + '</th>';
        }).join(''))}</tr></thead>
        <tbody>${raw(body)}</tbody>
      </table>`;

    document.body.appendChild(host);

    function done() {
      window.removeEventListener('afterprint', done);
      if (host.parentNode) host.remove();
    }
    window.addEventListener('afterprint', done);
    /* Safari fires afterprint unreliably, so there is a belt-and-braces timer. */
    setTimeout(done, 60000);

    SM.toast.info('Opening the print dialog',
      'Choose "Save as PDF" as the destination. Switch off headers and footers ' +
      'for a clean form.');
    /*
      A beat, so the toast paints before the print dialog blocks the thread.
      A timer rather than requestAnimationFrame: rAF does not fire in a hidden
      tab, which would leave the dialog waiting until the tab was looked at
      again.
    */
    setTimeout(function () { window.print(); }, 60);
  }

  var raw = SM.dom.raw;

  function describeRange(state) {
    if (state.from && state.to) {
      return SM.fmt.dateLabel(state.from) + ' to ' + SM.fmt.dateLabel(state.to);
    }
    if (state.from) return 'from ' + SM.fmt.dateLabel(state.from);
    if (state.to) return 'up to ' + SM.fmt.dateLabel(state.to);
    return 'all records';
  }

  /* ---------- the data files ---------- */

  /*
    Five separate downloads rather than one archive: writing a valid zip by hand
    is a few hundred lines of CRC and header packing, and five files a person can
    read in Notepad is a better answer than one they cannot.
  */
  function data() {
    var files = SM.store.serializeAll();
    var names = {
      system_types: 'sysmon-system-types.txt',
      locations: 'sysmon-locations.txt',
      checks: 'sysmon-checks.txt',
      activity: 'sysmon-activity.txt',
      settings: 'sysmon-settings.txt'
    };
    var order = ['system_types', 'locations', 'checks', 'activity', 'settings'];
    var when = stamp();

    order.forEach(function (table, index) {
      /*
        Staggered, because several download() calls in the same tick get
        collapsed into one prompt by some browsers.
      */
      setTimeout(function () {
        SM.dom.download(names[table].replace('.txt', '-' + when + '.txt'), files[table]);
      }, index * 250);
    });

    SM.toast.success('Exported 5 data files',
      'Keep them together; Import reads them in any order.');
    return order.length;
  }

  return { csv: csv, qm: qm, print: print, data: data, MAX_ROWS: MAX_ROWS };
})();
