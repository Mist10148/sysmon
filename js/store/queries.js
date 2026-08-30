/*
  Reads.

  Everything a page displays comes from here, already joined. A location arrives
  carrying its system's name, colour, icon and check method; a check arrives
  carrying its site's name and address as well. Storing those copies would be
  faster and would eventually be wrong, so they are computed on read and the
  expensive ones are memoised against the table revision counters.
*/
window.SM = window.SM || {};

SM.queries = (function () {
  'use strict';

  var cache = {};

  function memo(key, deps, compute) {
    var stamp = deps.join(':');
    var hit = cache[key];
    if (hit && hit.stamp === stamp) return hit.value;
    var value = compute();
    cache[key] = { stamp: stamp, value: value };
    return value;
  }

  function revs() {
    return [SM.store.rev('system_types'), SM.store.rev('locations'),
            SM.store.rev('checks'), SM.store.rev('activity')];
  }

  /* ---------- system types ---------- */

  function systemIndex() {
    return memo('systemIndex', [SM.store.rev('system_types')], function () {
      var byId = {};
      var list = SM.store.get().system_types;
      for (var i = 0; i < list.length; i++) byId[list[i].id] = list[i];
      return byId;
    });
  }

  function systemById(id) { return systemIndex()[id] || null; }

  function targetCounts() {
    return memo('targetCounts', [SM.store.rev('locations')], function () {
      var counts = {};
      var list = SM.store.get().locations;
      for (var i = 0; i < list.length; i++) {
        var key = list[i].system_type_id;
        counts[key] = (counts[key] || 0) + 1;
      }
      return counts;
    });
  }

  function systemTypes(options) {
    var opts = options || {};
    var counts = targetCounts();
    var out = [];
    var list = SM.store.get().system_types;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!opts.includeInactive && !s.active) continue;
      out.push(withCount(s, counts[s.id] || 0));
    }
    return out;
  }

  function withCount(system, count) {
    var copy = {};
    for (var k in system) copy[k] = system[k];
    copy.target_count = count;
    return copy;
  }

  /* ---------- locations ---------- */

  function decorateLocation(loc) {
    var system = systemById(loc.system_type_id);
    var copy = {};
    for (var k in loc) copy[k] = loc[k];
    copy.system_type_name = system ? system.name : 'Unassigned';
    copy.system_type_slug = system ? system.slug : '';
    copy.system_type_color = system ? system.color : 'slate';
    copy.system_type_icon = system ? system.icon : 'monitor';
    copy.check_method = system ? system.check_method : 'ping';
    copy.system = system;
    return copy;
  }

  function locations(options) {
    var opts = options || {};
    return memo('locations:' + (opts.includeInactive ? 'all' : 'active') +
                ':' + (opts.systemTypeId || 0),
      revs(), function () {
        var out = [];
        var list = SM.store.get().locations;
        for (var i = 0; i < list.length; i++) {
          var loc = list[i];
          if (!opts.includeInactive && !loc.active) continue;
          if (opts.systemTypeId && loc.system_type_id !== opts.systemTypeId) continue;
          out.push(decorateLocation(loc));
        }
        return out;
      });
  }

  function locationById(id) {
    var list = SM.store.get().locations;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return decorateLocation(list[i]);
    }
    return null;
  }

  /* ---------- checks ---------- */

  /*
    The latest check per site. Built once per change to the checks table and
    reused by the dashboard, the map, the Locations table and the sweep engine,
    which is why it is worth memoising rather than scanning per caller.
  */
  function latestByLocation() {
    return memo('latestByLocation', [SM.store.rev('checks')], function () {
      var latest = {};
      var list = SM.store.get().checks;
      /* The array is kept in ascending checked_at order, so last wins. */
      for (var i = 0; i < list.length; i++) {
        latest[list[i].location_id] = list[i];
      }
      return latest;
    });
  }

  /* One row per active site, with its latest result folded in. */
  function currentStatus(options) {
    var opts = options || {};
    var latest = latestByLocation();
    return locations({ systemTypeId: opts.systemTypeId }).map(function (loc) {
      var check = latest[loc.id] || null;
      loc.latest = check;
      loc.status = check ? check.status : 'Unknown';
      loc.checked_at = check ? check.checked_at : null;
      loc.avg_latency_ms = check ? check.avg_latency_ms : null;
      loc.loss_pct = check ? check.loss_pct : null;
      loc.http_status = check ? check.http_status : null;
      loc.source = check ? check.source : null;
      return loc;
    });
  }

  function summary(rows) {
    var out = { total: rows.length, functional: 0, down: 0, unchecked: 0, lastSweep: null };
    for (var i = 0; i < rows.length; i++) {
      var s = rows[i].status;
      if (s === 'Down') out.down++;
      else if (s === 'Unknown') out.unchecked++;
      else out.functional++;
      var at = rows[i].checked_at;
      if (at && (!out.lastSweep || at > out.lastSweep)) out.lastSweep = at;
    }
    return out;
  }

  function lastSweepAt() {
    var list = SM.store.get().checks;
    return list.length ? list[list.length - 1].checked_at : null;
  }

  function decorateCheck(check) {
    var loc = null;
    var list = SM.store.get().locations;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === check.location_id) { loc = list[i]; break; }
    }
    var system = loc ? systemById(loc.system_type_id) : null;
    var copy = {};
    for (var k in check) copy[k] = check[k];
    copy.location_name = loc ? loc.name : 'Removed site';
    copy.location_ip = loc ? loc.ip : '';
    copy.system_type_id = loc ? loc.system_type_id : null;
    copy.system_type_name = system ? system.name : '';
    copy.system_type_color = system ? system.color : 'slate';
    return copy;
  }

  /*
    History and the exporters share this. Filtering, then sorting, then paging -
    in that order, so the row numbers in the "No." column count the filtered set
    rather than the whole table.
  */
  function history(options) {
    var opts = options || {};
    var rows = [];
    var list = SM.store.get().checks;
    var needle = (opts.q || '').trim().toLowerCase();
    var words = needle ? needle.split(/\s+/) : null;

    for (var i = 0; i < list.length; i++) {
      var check = list[i];
      var day = SM.fmt.dayOf(check.checked_at);
      if (opts.from && day < opts.from) continue;
      if (opts.to && day > opts.to) continue;
      if (opts.locationId && check.location_id !== opts.locationId) continue;
      if (opts.status && check.status !== opts.status) continue;

      var row = decorateCheck(check);
      if (opts.systemTypeId && row.system_type_id !== opts.systemTypeId) continue;

      if (words) {
        var hay = (row.location_name + ' ' + row.location_ip + ' ' +
                   row.system_type_name + ' ' + (row.issues || '') + ' ' +
                   (row.remarks || '')).toLowerCase();
        var ok = true;
        for (var w = 0; w < words.length; w++) {
          if (hay.indexOf(words[w]) === -1) { ok = false; break; }
        }
        if (!ok) continue;
      }
      rows.push(row);
    }

    var key = opts.sort || 'checked_at';
    var dir = opts.dir === 'asc' ? 1 : -1;
    rows.sort(function (a, b) {
      var cmp = 0;
      if (key === 'location') cmp = SM.fmt.compareText(a.location_name, b.location_name);
      else if (key === 'system') cmp = SM.fmt.compareText(a.system_type_name, b.system_type_name);
      else if (key === 'status') cmp = SM.fmt.compareText(a.status, b.status);
      else cmp = a.checked_at < b.checked_at ? -1 : (a.checked_at > b.checked_at ? 1 : 0);
      if (cmp === 0) cmp = a.id - b.id;
      return cmp * dir;
    });

    var total = rows.length;
    if (opts.pageSize) {
      var start = ((opts.page || 1) - 1) * opts.pageSize;
      rows = rows.slice(start, start + opts.pageSize);
    }
    return { rows: rows, total: total };
  }

  function checkById(id) {
    var list = SM.store.get().checks;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ---------- activity ---------- */

  function activity(options) {
    var opts = options || {};
    var rows = [];
    var list = SM.store.get().activity;

    /* Newest first, so the loop runs backwards over the ascending array. */
    for (var i = list.length - 1; i >= 0; i--) {
      var row = list[i];
      var day = SM.fmt.dayOf(row.at);
      if (opts.from && day < opts.from) continue;
      if (opts.to && day > opts.to) continue;
      if (opts.kind && row.kind !== opts.kind) continue;
      if (opts.severity && row.severity !== opts.severity) continue;
      if (opts.systemTypeId && row.system_type_id !== opts.systemTypeId) continue;
      rows.push(row);
    }

    var total = rows.length;
    if (opts.pageSize) {
      var start = ((opts.page || 1) - 1) * opts.pageSize;
      rows = rows.slice(start, start + opts.pageSize);
    }
    return { rows: rows, total: total };
  }

  /* Groups a page of activity rows by calendar day, in the order given. */
  function groupByDay(rows) {
    var groups = [];
    var current = null;
    for (var i = 0; i < rows.length; i++) {
      var day = SM.fmt.dayOf(rows[i].at);
      if (!current || current.day !== day) {
        current = { day: day, label: SM.fmt.dayHeading(rows[i].at), rows: [] };
        groups.push(current);
      }
      current.rows.push(rows[i]);
    }
    return groups;
  }

  /* ---------- shared list helpers ---------- */

  /*
    Multi-word AND search across a named set of fields. "sara queue" matches a
    row only if both words appear somewhere in it, which is how a person
    narrowing a list expects a second word to behave.
  */
  function matches(row, fields, query) {
    var needle = (query || '').trim().toLowerCase();
    if (!needle) return true;
    var hay = '';
    for (var f = 0; f < fields.length; f++) {
      var value = row[fields[f]];
      if (value != null) hay += String(value).toLowerCase() + ' ';
    }
    var words = needle.split(/\s+/);
    for (var w = 0; w < words.length; w++) {
      if (hay.indexOf(words[w]) === -1) return false;
    }
    return true;
  }

  function statusRank(status) {
    if (status === 'Down') return 0;
    if (status === 'Unknown') return 1;
    if (status === 'Restored') return 2;
    return 3;
  }

  function invalidate() { cache = {}; }

  return {
    systemTypes: systemTypes, systemById: systemById, targetCounts: targetCounts,
    locations: locations, locationById: locationById, decorateLocation: decorateLocation,
    latestByLocation: latestByLocation, currentStatus: currentStatus, summary: summary,
    lastSweepAt: lastSweepAt, history: history, checkById: checkById,
    decorateCheck: decorateCheck,
    activity: activity, groupByDay: groupByDay,
    matches: matches, statusRank: statusRank, invalidate: invalidate
  };
})();
