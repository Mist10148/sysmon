/*
  The built-in seed.

  These are the same five systems and eight sites the previous build seeded, so
  a fresh install of either one starts from the same picture.

  The seed is a JavaScript string rather than a file fetched from data/, and
  that is not laziness: fetch() is blocked on file:// by the same-origin policy,
  so a seed that had to be fetched would mean SysMon only worked through a web
  server. The files in data/ are sample exports - the format's reference, and
  what Import reads - not the source of this.

  Checks and activity are not seeded. js/domain/backfill.js generates them from
  the same deterministic streams the live sweep uses, so History and Analytics
  have real structure to show on the first load rather than a blank month.
*/
window.SM = window.SM || {};

SM.seed = (function () {
  'use strict';

  var SYSTEM_TYPES = [
    '# SysMon - system types',
    '# @version 1',
    '# @table system_types',
    '@columns\tid\tsort_order\tslug\tname\tdescription\tcolor\ticon\tcheck_method\thttp_scheme\thttp_port\thttp_path\thttp_expect_status\tactive',
    '1\t1\tqueueing\tQueueing System\tTicket displays and counter terminals in each LHIO lobby\tviolet\tticket\tping\t-\t-\t-\t-\tyes',
    '2\t2\tnclaims\tNclaims\tClaims processing front end\tblue\tserver\thttp\thttps\t-\t/\t200\tyes',
    '3\t3\tmcris\tMcris\tMember contribution records\tteal\tdatabase\thttp\thttps\t-\t/\t200\tyes',
    '4\t4\tpmais\tPmais\tAccreditation and provider records\tamber\tshield\thttp\thttps\t-\t/\t200\tyes',
    '5\t5\tipas\tIpas\tInpatient authorisation\trose\theart-pulse\thttp\thttps\t-\t/\t200\tyes'
  ].join('\r\n') + '\r\n';

  /*
    Coordinates are approximate municipal centres, not surveyed office
    locations. They are close enough to put a pin in the right town and no
    closer, which is all the map is for.
  */
  var LOCATIONS = [
    '# SysMon - locations (site x system)',
    '# @version 1',
    '# @table locations',
    '@columns\tid\tsort_order\tsystem_type_id\tname\tip\tlat\tlng\tregion\tactive',
    '1\t1\t1\tANTIQUE\t172.24.142.144\t10.7402\t121.9391\tRegion VI\tyes',
    '2\t2\t1\tCAPIZ\t172.24.143.168\t11.5853\t122.7511\tRegion VI\tyes',
    '3\t3\t1\tBACOLOD\t172.24.143.10\t10.6765\t122.9509\tRegion VI\tyes',
    '4\t4\t1\tKABANKALAN\t172.24.144.252\t9.9889\t122.8136\tRegion VI\tyes',
    '5\t5\t1\tSARA\t172.24.145.153\t11.2536\t123.0086\tRegion VI\tyes',
    '6\t6\t1\tPASSI\t172.24.144.38\t11.1078\t122.6417\tRegion VI\tyes',
    '7\t7\t1\tAKLAN\t172.24.142.42\t11.7086\t122.3661\tRegion VI\tyes',
    '8\t8\t1\tGUIMARAS\t172.24.210.183\t10.5929\t122.5936\tRegion VI\tyes'
  ].join('\r\n') + '\r\n';

  function text(table) {
    if (table === 'system_types') return SYSTEM_TYPES;
    if (table === 'locations') return LOCATIONS;
    return null;   /* checks and activity are backfilled, not seeded */
  }

  return { text: text };
})();
