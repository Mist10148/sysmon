/*
  Import.

  Reads the .txt files back. Files are identified by their own @table line rather
  than by their filename, so an operator can rename them, hand-edit them, drop
  them in any order, or select only the two they actually changed.

  It is a replace, not a merge, and that is on purpose: merging two sets of rows
  that share ids has no correct answer, and quietly picking one would be the kind
  of data loss nobody notices for a month. Whatever tables the selected files
  contain are replaced wholesale; tables with no file are left alone, which is
  what makes "re-import just the locations file" work.

  Nothing is written until every file has parsed. A run that fails half way would
  leave the application holding half of one dataset and half of another.
*/
window.SM = window.SM || {};

SM.importer = (function () {
  'use strict';

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('Could not read ' + file.name)); };
      /*
        UTF-8, which is what Export writes. A file saved from Notepad as ANSI
        will still parse - the tabs and ASCII survive - and only an accented
        character in a remark would come through wrong.
      */
      reader.readAsText(file, 'utf-8');
    });
  }

  /*
    files: a FileList or array.
    Resolves with { tables, counts, warnings, skipped } and does not apply
    anything; call apply() with the result. Two steps, so the confirmation can
    say what is about to be replaced.
  */
  function inspect(files) {
    var list = Array.prototype.slice.call(files);
    if (!list.length) return Promise.reject(new Error('No files chosen.'));

    return Promise.all(list.map(function (file) {
      return readFile(file).then(function (text) {
        return { name: file.name, text: text };
      });
    })).then(function (loaded) {
      var tables = {};
      var counts = {};
      var warnings = [];
      var skipped = [];

      for (var i = 0; i < loaded.length; i++) {
        var file = loaded[i];
        var table = SM.txt.detectTable(file.text);

        if (!table) {
          skipped.push(file.name + ' - not a SysMon data file');
          continue;
        }

        if (table === 'settings') {
          /* Guarded here as well as below: this branch returns before the
             duplicate check every other table gets, so without this a second
             settings file would silently overwrite the first. */
          if (tables.settings) {
            skipped.push(file.name + ' - a second file for settings, ignored');
            continue;
          }
          tables.settings = SM.txt.parseSettings(file.text);
          counts.settings = Object.keys(tables.settings).length;
          continue;
        }

        if (!SM.schema.TABLES[table]) {
          skipped.push(file.name + ' - unknown table "' + table + '"');
          continue;
        }

        var parsed;
        try {
          parsed = SM.txt.parse(table, file.text);
        } catch (err) {
          /* One bad file fails the whole import rather than half-applying it. */
          throw new Error(file.name + ': ' + err.message);
        }

        if (tables[table]) {
          skipped.push(file.name + ' - a second file for ' + table + ', ignored');
          continue;
        }

        tables[table] = parsed.rows;
        counts[table] = parsed.rows.length;
        for (var w = 0; w < parsed.warnings.length; w++) {
          warnings.push(file.name + ': ' + parsed.warnings[w]);
        }
      }

      if (!Object.keys(tables).length) {
        throw new Error('None of those files held SysMon data.');
      }

      validate(tables, warnings);
      return { tables: tables, counts: counts, warnings: warnings, skipped: skipped };
    });
  }

  /*
    Cross-file checks worth making before anything is replaced. These warn rather
    than refuse: a locations file imported on its own legitimately points at
    system ids that are already in the application.
  */
  function validate(tables, warnings) {
    if (tables.locations) {
      var systemIds = {};
      var systems = tables.system_types || SM.store.get().system_types;
      for (var s = 0; s < systems.length; s++) systemIds[systems[s].id] = true;

      var orphans = 0;
      for (var l = 0; l < tables.locations.length; l++) {
        if (!systemIds[tables.locations[l].system_type_id]) orphans++;
      }
      if (orphans) {
        warnings.push(SM.fmt.plural(orphans, 'site') +
          ' point at a system that does not exist and will show as Unassigned.');
      }
    }

    if (tables.checks) {
      var locationIds = {};
      var locations = tables.locations || SM.store.get().locations;
      for (var i = 0; i < locations.length; i++) locationIds[locations[i].id] = true;

      var stray = 0;
      for (var c = 0; c < tables.checks.length; c++) {
        if (!locationIds[tables.checks[c].location_id]) stray++;
      }
      if (stray) {
        warnings.push(SM.fmt.plural(stray, 'record') +
          ' belong to a site that does not exist and will show as "Removed site".');
      }
    }
  }

  function apply(result) {
    SM.store.replaceAll(result.tables);
    /* Written now rather than on the debounce, since this replaced everything. */
    SM.storage.flush();

    var replaced = Object.keys(result.counts).map(function (table) {
      return result.counts[table] + ' ' + table.replace('_', ' ');
    }).join(', ');

    SM.activityLog.write({
      kind: 'settings', action: 'settings.update', severity: 'warning',
      subject: 'Data imported', detail: 'Replaced ' + replaced
    });

    return replaced;
  }

  return { inspect: inspect, apply: apply };
})();
