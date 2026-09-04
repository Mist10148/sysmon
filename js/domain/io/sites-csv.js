/*
  Sites in and out as a spreadsheet.

  The verb here is MERGE, and that is the whole reason this is not part of
  js/domain/io/import.js. That importer replaces a table wholesale, because a
  SysMon .txt export is a complete table with its ids intact. A CSV of sites is
  somebody's spreadsheet: it has no ids, it is usually a partial list, and the
  intent behind handing it over is "add these" - never "delete everything I did
  not mention".

  Rows are matched on site name plus system, because that pair is what a person
  means by "the same row". Matching on IP would rename a site when its address
  changed, which is exactly backwards.
*/
window.SM = window.SM || {};

(function () {
  'use strict';

  /* The header written on export, and the one inspect() reads back. */
  var COLUMNS = ['LHIO', 'System', 'IP', 'Region', 'Latitude', 'Longitude', 'Active'];

  function cell(value) {
    var text = value == null ? '' : String(value);
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  /* ---------- out ---------- */

  function exportSites() {
    var rows = SM.queries.locations({ includeInactive: true });
    if (!rows.length) { SM.toast.warning('No sites to export'); return; }

    var lines = [COLUMNS.map(cell).join(',')];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      lines.push([
        row.name,
        row.system_type_name || '',
        row.ip,
        row.region,
        row.lat,
        row.lng,
        row.active ? 'yes' : 'no'
      ].map(cell).join(','));
    }

    /* BOM and CRLF, for the same reason the history export carries them. */
    SM.dom.download('sysmon-sites.csv', '\uFEFF' + lines.join('\r\n') + '\r\n', 'text/csv');
    SM.toast.success('Sites exported', SM.fmt.plural(rows.length, 'site'));
  }

  /* ---------- in ---------- */

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('Could not read ' + file.name)); };
      reader.readAsText(file, 'utf-8');
    });
  }

  function systemByName(name) {
    var wanted = SM.csv.normalise(name);
    if (!wanted) return null;
    var list = SM.queries.systemTypes({ includeInactive: true });
    for (var i = 0; i < list.length; i++) {
      if (SM.csv.normalise(list[i].name) === wanted) return list[i];
      if (SM.csv.normalise(list[i].slug) === wanted) return list[i];
    }
    return null;
  }

  function truthy(value) {
    var v = String(value || '').trim().toLowerCase();
    return v === 'yes' || v === 'true' || v === '1' || v === 'y';
  }

  /*
    Look at the file and decide what would happen, without doing any of it.

    Same two-phase shape as SM.importer: inspect() is pure and its result is
    what the confirm dialog is built from, so nobody is asked to approve a
    summary that was generated separately from the work.
  */
  function inspect(file) {
    return readFile(file).then(function (text) {
      return inspectText(text, file.name);
    });
  }

  /* The whole decision, with no file in it. */
  function inspectText(text, name) {
    var doc = SM.csv.read(text);

    if (!doc.records.length) {
      throw new Error('That file has a header but no rows.');
    }
    if (doc.header.indexOf('lhio') < 0 && doc.header.indexOf('name') < 0) {
      throw new Error('No LHIO column - is this a SysMon sites file?');
    }

    var existing = SM.queries.locations({ includeInactive: true });
    var byKey = {};
    for (var i = 0; i < existing.length; i++) {
      byKey[key(existing[i].name, existing[i].system_type_id)] = existing[i];
    }

    var adds = [];
    var updates = [];
    var warnings = [];
    var seen = {};

    for (var r = 0; r < doc.records.length; r++) {
      var rec = doc.records[r];
      var name = rec.lhio || rec.name || '';
      var where = 'Line ' + rec.__line;

      if (!name) { warnings.push(where + ': no site name, skipped'); continue; }

      var system = systemByName(rec.system);
      if (!system) {
        warnings.push(where + ': no system called "' + (rec.system || '') +
                      '", ' + name + ' skipped');
        continue;
      }

      var k = key(name, system.id);
      if (seen[k]) {
        warnings.push(where + ': ' + name + ' listed twice, later row wins');
      }
      seen[k] = true;

      var row = {
        name: name,
        system_type_id: system.id,
        ip: rec.ip || rec.ipaddress || '',
        region: rec.region || '',
        lat: num(rec.latitude != null ? rec.latitude : rec.lat),
        lng: num(rec.longitude != null ? rec.longitude : rec.lng),
        active: rec.active === '' || rec.active == null ? true : truthy(rec.active)
      };

      var match = byKey[k];
      if (match) updates.push({ id: match.id, row: row, name: name });
      else adds.push(row);
    }

    if (!adds.length && !updates.length) {
      throw new Error('Nothing in that file could be matched to a system.');
    }

    return { adds: adds, updates: updates, warnings: warnings, name: name };
  }

  function key(name, systemId) {
    return SM.csv.normalise(name) + '\u0000' + systemId;
  }

  function num(value) {
    var n = Number(String(value == null ? '' : value).trim());
    return isNaN(n) ? 0 : n;
  }

  /*
    Apply what inspect() described. Everything goes through the ordinary
    mutations, so each row is clipped, clamped and written to the activity log
    exactly as if it had been typed into the Add site form.
  */
  function apply(result) {
    for (var i = 0; i < result.updates.length; i++) {
      SM.mutate.updateLocation(result.updates[i].id, result.updates[i].row);
    }
    for (var a = 0; a < result.adds.length; a++) {
      SM.mutate.createLocation(result.adds[a]);
    }

    var parts = [];
    if (result.adds.length) parts.push(SM.fmt.plural(result.adds.length, 'site') + ' added');
    if (result.updates.length) parts.push(result.updates.length + ' updated');
    return parts.join(', ');
  }

  SM.sitesCsv = {
    COLUMNS: COLUMNS, exportSites: exportSites,
    inspect: inspect, inspectText: inspectText, apply: apply
  };
})();
