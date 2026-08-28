/*
  The .txt record format.

  SysMon has no database. Its data is text: a comment header, a line naming the
  columns, then one tab-separated record per line. The same format is used for
  the built-in seed, for what Export writes, and for what is kept in
  localStorage - one format means one serialiser to get right.

  Why tabs rather than CSV: the fields that most need to survive a round trip
  are free text written by an operator - "Issues encountered", "Remarks" - and
  those contain commas and quotes constantly. Quoting rules are the part of CSV
  that everyone implements slightly differently. A tab is a character nobody
  types into a form, so escaping it is enough.

  Escapes, inside any field:  \t  \n  \\
  An empty field is a single dash, so a row never has two tabs in a row and
  cannot be silently misaligned by an editor that trims whitespace.
  Booleans are yes / no, because a person reads this file.
*/
window.SM = window.SM || {};

SM.txt = (function () {
  'use strict';

  var EMPTY = '-';

  function escapeField(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\t/g, '\\t')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  function unescapeField(value) {
    var out = '';
    for (var i = 0; i < value.length; i++) {
      var c = value.charAt(i);
      if (c !== '\\') { out += c; continue; }
      var n = value.charAt(++i);
      if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === '\\') out += '\\';
      else out += n;   /* an unknown escape keeps its second character */
    }
    return out;
  }

  function writeCell(value, type) {
    if (value == null || value === '') return EMPTY;
    if (type === 'bool') return value ? 'yes' : 'no';
    if (type === 'num') {
      var n = Number(value);
      if (isNaN(n)) return EMPTY;
      /* Coordinates need six places; latency does not need any. */
      return String(Math.round(n * 1e6) / 1e6);
    }
    if (type === 'int') {
      var i = Math.round(Number(value));
      return isNaN(i) ? EMPTY : String(i);
    }
    return escapeField(value);
  }

  function readCell(cell, type, fallback) {
    if (cell == null || cell === '' || cell === EMPTY) return fallback;
    if (type === 'bool') {
      var v = cell.toLowerCase();
      return v === 'yes' || v === 'true' || v === '1';
    }
    if (type === 'int') {
      var i = parseInt(cell, 10);
      return isNaN(i) ? fallback : i;
    }
    if (type === 'num') {
      var n = parseFloat(cell);
      return isNaN(n) ? fallback : n;
    }
    return unescapeField(cell);
  }

  /* ---------- tables ---------- */

  function serialize(table, rows, exportedAt) {
    var def = SM.schema.TABLES[table];
    var cols = def.columns;
    var lines = [];

    lines.push('# SysMon - ' + def.title);
    lines.push('# @version ' + SM.schema.VERSION);
    lines.push('# @table ' + table);
    lines.push('# @exported ' + (exportedAt || SM.fmt.iso()));
    lines.push('# An empty field is a dash. Booleans are yes or no. Fields are tab-separated.');
    if (def.note) lines.push('# ' + def.note);

    var header = ['@columns'];
    for (var c = 0; c < cols.length; c++) header.push(cols[c][0]);
    lines.push(header.join('\t'));

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var cells = [];
      for (var i = 0; i < cols.length; i++) {
        cells.push(writeCell(row[cols[i][0]], cols[i][1]));
      }
      lines.push(cells.join('\t'));
    }

    /*
      CRLF, because the most likely thing to open one of these files is Notepad
      on the same PC that runs the office. Every parser here accepts either.
    */
    return lines.join('\r\n') + '\r\n';
  }

  function parse(table, text) {
    var def = SM.schema.TABLES[table];
    if (!def) throw new Error('Unknown table: ' + table);

    var lines = String(text).split(/\r\n|\r|\n/);
    var version = null;
    var fileColumns = null;
    var rows = [];
    var warnings = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line || !line.trim()) continue;

      if (line.charAt(0) === '#') {
        var v = /^#\s*@version\s+(\d+)/.exec(line);
        if (v) version = parseInt(v[1], 10);
        continue;
      }

      if (line.indexOf('@columns') === 0) {
        fileColumns = line.split('\t').slice(1).map(function (s) { return s.trim(); });
        continue;
      }

      if (!fileColumns) {
        warnings.push('Line ' + (i + 1) + ' came before the @columns line and was skipped.');
        continue;
      }

      var cells = line.split('\t');
      var row = {};

      /* Defaults first, so a file written by an older version still loads. */
      for (var d = 0; d < def.columns.length; d++) {
        row[def.columns[d][0]] = def.columns[d][2];
      }

      /*
        Read by column name, not by position. A hand-edited file with the
        columns in a different order is still a valid file.
      */
      for (var c = 0; c < fileColumns.length; c++) {
        var name = fileColumns[c];
        var spec = findColumn(def, name);
        if (!spec) continue;    /* a column this version does not know about */
        row[name] = readCell(cells[c], spec[1], spec[2]);
      }

      if (!row.id) {
        warnings.push('Line ' + (i + 1) + ' has no id and was skipped.');
        continue;
      }
      rows.push(row);
    }

    if (version != null && version > SM.schema.VERSION) {
      throw new Error('This file was written by a newer version of SysMon (format ' +
        version + '; this build reads ' + SM.schema.VERSION + ').');
    }
    if (!fileColumns) {
      throw new Error('No @columns line found - this does not look like a SysMon data file.');
    }

    return { rows: rows, warnings: warnings, version: version };
  }

  function findColumn(def, name) {
    for (var i = 0; i < def.columns.length; i++) {
      if (def.columns[i][0] === name) return def.columns[i];
    }
    return null;
  }

  /* ---------- settings ---------- */
  /*
    key = value, aligned, with comments allowed. This is the file an operator is
    most likely to open and change by hand, so it is the one that reads like a
    configuration file rather than a table.
  */

  function serializeSettings(settings, exportedAt) {
    var lines = [];
    lines.push('# SysMon - settings');
    lines.push('# @version ' + SM.schema.VERSION);
    lines.push('# @table settings');
    lines.push('# @exported ' + (exportedAt || SM.fmt.iso()));
    lines.push('# key = value. Lines beginning with # are ignored.');
    lines.push('');

    var keys = Object.keys(SM.schema.DEFAULT_SETTINGS);
    /* Any key the running build does not know about is still written back. */
    Object.keys(settings).forEach(function (k) {
      if (keys.indexOf(k) === -1) keys.push(k);
    });

    var width = 0;
    keys.forEach(function (k) { if (k.length > width) width = k.length; });

    keys.forEach(function (k) {
      var value = settings[k];
      if (value == null) value = SM.schema.DEFAULT_SETTINGS[k];
      if (value == null) value = '';
      var padded = k;
      while (padded.length < width) padded += ' ';
      lines.push(padded + ' = ' + String(value).replace(/[\r\n]+/g, ' '));
    });

    return lines.join('\r\n') + '\r\n';
  }

  function parseSettings(text) {
    var out = {};
    var lines = String(text).split(/\r\n|\r|\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '#') continue;
      var at = line.indexOf('=');
      if (at === -1) continue;
      var key = line.slice(0, at).trim();
      var value = line.slice(at + 1).trim();
      if (key) out[key] = value;
    }
    return out;
  }

  /*
    Which table a file holds, from its @table line or, failing that, from its
    columns. Import uses this so a person can drop five files in at once and
    not have to say which is which.
  */
  function detectTable(text) {
    var m = /^#\s*@table\s+([a-z_]+)/m.exec(text);
    if (m) return m[1];

    var cols = /^@columns\t(.*)$/m.exec(text);
    if (!cols) {
      if (/^\s*[a-z_]+\s*=/m.test(text)) return 'settings';
      return null;
    }
    var names = cols[1].split('\t').map(function (s) { return s.trim(); });
    var tables = SM.schema.tableNames();
    var best = null, bestScore = 0;
    for (var t = 0; t < tables.length; t++) {
      var want = SM.schema.columnNames(tables[t]);
      var score = 0;
      for (var i = 0; i < names.length; i++) if (want.indexOf(names[i]) !== -1) score++;
      /* Normalised, or the widest table always wins. */
      score = score / want.length;
      if (score > bestScore) { bestScore = score; best = tables[t]; }
    }
    return bestScore >= 0.6 ? best : null;
  }

  return {
    serialize: serialize,
    parse: parse,
    serializeSettings: serializeSettings,
    parseSettings: parseSettings,
    detectTable: detectTable,
    escapeField: escapeField,
    unescapeField: unescapeField
  };
})();
