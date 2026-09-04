/*
  A CSV reader, for the one thing SysMon accepts as a spreadsheet: a list of
  sites.

  This is the exact inverse of csvCell in js/domain/io/exports.js, and nothing
  more. It is not a general parser: no delimiter sniffing, no type coercion, no
  streaming. RFC 4180 as Excel actually writes it - quoted fields, doubled
  quotes inside them, CRLF or LF between records, and a byte-order mark on the
  front that Excel adds and never mentions.

  It is deliberately separate from js/data/txt.js. The .txt format is SysMon's
  own and round-trips whole tables including their ids; a CSV of sites comes
  from somebody's spreadsheet and has no ids in it at all. Conflating the two
  is how an import that should have added four rows replaces eight hundred.
*/
window.SM = window.SM || {};

(function () {
  'use strict';

  /*
    Split one CSV document into rows of cells.

    The state that matters is whether the cursor is inside quotes; everything
    else falls out of that. A doubled quote inside a quoted field is a literal
    quote, which is the only reason this cannot be a regular expression.
  */
  function parse(text) {
    var input = String(text || '').replace(/^\uFEFF/, '');
    var rows = [];
    var row = [];
    var cell = '';
    var quoted = false;
    var i = 0;

    while (i < input.length) {
      var ch = input.charAt(i);

      if (quoted) {
        if (ch === '"') {
          if (input.charAt(i + 1) === '"') { cell += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        cell += ch; i++; continue;
      }

      if (ch === '"') { quoted = true; i++; continue; }
      if (ch === ',') { row.push(cell); cell = ''; i++; continue; }

      if (ch === '\r' || ch === '\n') {
        /* CRLF is one break, not two. */
        if (ch === '\r' && input.charAt(i + 1) === '\n') i++;
        row.push(cell); cell = '';
        rows.push(row); row = [];
        i++; continue;
      }

      cell += ch; i++;
    }

    /* Whatever is left when the text runs out is the last cell. */
    row.push(cell);
    rows.push(row);

    /* A trailing newline leaves one empty row behind; nothing else may go. */
    return rows.filter(function (r, index) {
      return !(index === rows.length - 1 && r.length === 1 && r[0] === '');
    });
  }

  /*
    Rows to objects, keyed by a normalised header.

    Headers are matched loosely - case, spaces and underscores are all noise
    when the file came out of somebody's spreadsheet - so "IP Address", "ip"
    and "IP_ADDRESS" are the same column.
  */
  function normalise(name) {
    return String(name || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  }

  function toObjects(rows) {
    if (!rows.length) return { header: [], records: [] };

    var header = rows[0].map(normalise);
    var records = [];

    for (var i = 1; i < rows.length; i++) {
      var cells = rows[i];
      /* A row of nothing but commas is not a record. */
      var blank = cells.every(function (c) { return String(c).trim() === ''; });
      if (blank) continue;

      var record = { __line: i + 1 };
      for (var c = 0; c < header.length; c++) {
        if (!header[c]) continue;
        record[header[c]] = (cells[c] == null ? '' : String(cells[c])).trim();
      }
      records.push(record);
    }

    return { header: header, records: records };
  }

  function read(text) {
    return toObjects(parse(text));
  }

  SM.csv = { parse: parse, read: read, normalise: normalise };
})();
