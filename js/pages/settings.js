/*
  Settings.

  Four cards, and the shape of this page is where the honest differences between
  this build and the previous one live.

  Gone: accounts, SMTP delivery and outage email. A static page has nobody to
  authenticate against and no way to send mail, and a switch that pretends
  otherwise is worse than no switch. Desktop notifications do what can actually
  be done on the machine that is running SysMon.

  Gone: the TXT backup folder. A browser cannot write to a folder on its own
  schedule. Export does the same job when asked, and the Data card is where it
  lives.

  Changed: automatic sweeps are a timer in this tab. Every five minutes means
  every five minutes SysMon is open, and the card says so rather than letting
  someone close the tab believing something is still watching.
*/
window.SM = window.SM || {};
SM.pages = SM.pages || {};

SM.pages.settings = (function () {
  'use strict';

  var html = SM.dom.html;
  var raw = SM.dom.raw;

  function mount(ctx) {
    var root = ctx.view;

    root.innerHTML = html`
      <div id="g-header"></div>
      <div class="page-body">
        <div class="settings-grid" id="g-grid"></div>
      </div>`;

    var elHeader = SM.dom.qs('#g-header', root);
    var elGrid = SM.dom.qs('#g-grid', root);

    function update() {
      elHeader.innerHTML = SM.ui.PageHeader({
        title: 'Settings',
        desc: 'How often sites are checked, how the simulation behaves, and where ' +
              'your data goes'
      }).__html;

      elGrid.innerHTML =
        sweepsCard() + optionsCard() + dataCard() + notificationsCard() + appearanceCard();
    }

    /* ---------- automatic sweeps ---------- */

    function sweepsCard() {
      var state = SM.scheduler.state();
      var on = SM.store.settingOn('auto_sweep_enabled');

      return SM.ui.Card({
        icon: 'timer',
        title: 'Automatic sweeps',
        desc: 'A timer in this tab. It stops when SysMon is closed.',
        body: raw(html`
          <div class="setting-rows">
            ${SM.ui.SwitchRow({
              name: 'auto_sweep_enabled', act: 'toggle-auto', checked: on,
              label: 'Check on a schedule',
              hint: 'Runs while this tab is open, including in the background'
            })}

            ${SM.ui.Field({
              name: 'auto_sweep_minutes', label: 'Check every (minutes)', type: 'number',
              value: SM.store.settingInt('auto_sweep_minutes'),
              min: 1, max: 1440, act: 'set-interval', disabled: !on
            })}

            <div class="status-box">
              <div class="status-box-line">
                ${state.running
                  ? raw('<strong>Running</strong> · every ' +
                        SM.dom.esc(SM.fmt.plural(state.intervalMinutes, 'minute')))
                  : raw('<strong>Not running</strong> · nothing is checked automatically')}
              </div>
              <div class="status-box-line">
                ${state.lastRunAt
                  ? 'Last sweep ' + SM.fmt.relative(state.lastRunAt)
                  : 'No sweep recorded yet'}
              </div>
              ${state.lastError
                ? raw('<div class="status-box-error">Last error: ' +
                      SM.dom.esc(state.lastError) + '</div>')
                : ''}
            </div>
          </div>`)
      }).__html;
    }

    /* ---------- sweep options ---------- */

    function optionsCard() {
      var packets = SM.store.settingInt('sweep_packets');
      var timeout = SM.store.settingInt('sweep_timeout_ms');
      var worst = ((packets * timeout) / 1000).toFixed(1);

      return SM.ui.Card({
        icon: 'gauge',
        title: 'Sweep options',
        desc: 'What a check looks like. These shape the simulated results and how ' +
              'long a sweep appears to take.',
        body: raw(html`
          <div class="setting-rows">
            ${SM.ui.Field({
              name: 'sweep_packets', label: 'Packets per site', type: 'number',
              value: packets, min: 1, max: 20, act: 'set-packets'
            })}
            ${SM.ui.Field({
              name: 'sweep_timeout_ms', label: 'Timeout per packet (ms)', type: 'number',
              value: timeout, min: 100, max: 20000, step: 100, act: 'set-timeout',
              hint: 'A fully unreachable site would take about ' + worst + 's'
            })}
            <p class="info-block">
              A browser cannot send an ICMP echo request, so results are simulated
              from a seed rather than measured. Everything built on them — the
              records, the outages, the exports — is real.
            </p>
          </div>`)
      }).__html;
    }

    /* ---------- data ---------- */

    function dataCard() {
      var used = SM.storage.usedBytes();
      var counts = SM.store.get();

      return SM.ui.Card({
        icon: 'database',
        title: 'Data',
        desc: 'Everything lives in this browser. Export is how it leaves.',
        body: raw(html`
          <div class="setting-rows">
            <div class="status-box">
              <div class="status-box-line">
                <strong>${SM.fmt.plural(counts.checks.length, 'check')}</strong> ·
                ${SM.fmt.plural(counts.locations.length, 'site')} ·
                ${SM.fmt.plural(counts.system_types.length, 'system')} ·
                ${SM.fmt.plural(counts.activity.length, 'activity entry', 'activity entries')}
              </div>
              <div class="status-box-line">
                Using about ${SM.fmt.bytes(used)} of this browser's storage
              </div>
              ${!SM.storage.available()
                ? raw('<div class="status-box-error">This browser is not saving ' +
                      'anything — private mode, or storage is blocked. Changes will ' +
                      'be lost on reload.</div>')
                : ''}
            </div>

            <div class="flex flex-wrap gap-2">
              ${SM.ui.Button({ label: 'Export data files', icon: 'download',
                               variant: 'secondary', act: 'export-data' })}
              ${SM.ui.Button({ label: 'Import', icon: 'upload',
                               variant: 'secondary', act: 'import-data' })}
              ${SM.ui.Button({ label: 'Start again from the seed', icon: 'rotate-ccw',
                               variant: 'ghost', act: 'reset-data' })}
            </div>

            <input type="file" class="file-input" id="import-input"
                   accept=".txt,text/plain" multiple>

            <p class="field-hint">
              Export writes five .txt files you can read in Notepad. Import replaces
              whatever tables the files you choose contain, and leaves the rest alone.
            </p>
          </div>`)
      }).__html;
    }

    /* ---------- notifications ---------- */

    function notificationsCard() {
      var permission = SM.notify.permission();
      var on = SM.notify.enabled();
      var blocked = permission === 'denied' || permission === 'unsupported';

      return SM.ui.Card({
        icon: on ? 'bell' : 'bell-off',
        title: 'Desktop notifications',
        desc: 'Tells this machine when a site goes down or comes back.',
        body: raw(html`
          <div class="setting-rows">
            ${SM.ui.SwitchRow({
              name: 'notifications_enabled', act: 'toggle-notify', checked: on,
              disabled: blocked,
              label: 'Notify me about outages and recoveries',
              hint: blocked
                ? (permission === 'unsupported'
                    ? 'This browser has no notification support.'
                    : 'Blocked in your browser settings — allow notifications for ' +
                      'this page, then switch it back on.')
                : 'Repeat alerts for the same site replace each other'
            })}
            ${on ? SM.ui.Button({ label: 'Send a test notification', variant: 'secondary',
                                  size: 'sm', act: 'test-notify' }) : ''}
            <p class="info-block">
              This replaces the email alerts of the previous build. A page with no
              server behind it cannot send mail, so an outage reaches whoever is
              at this machine — and nobody who has gone home.
            </p>
          </div>`)
      }).__html;
    }

    /* ---------- appearance ---------- */

    function appearanceCard() {
      return SM.ui.Card({
        icon: 'sun',
        title: 'Appearance',
        desc: 'System follows the operating system, and keeps following it.',
        /* Already markup; wrapping it in raw() again would stringify the object. */
        body: SM.ui.Segmented({
          act: 'set-theme', value: SM.theme.get(), ariaLabel: 'Theme',
          items: [{ value: 'light', label: 'Light', icon: 'sun' },
                  { value: 'dark', label: 'Dark', icon: 'moon' },
                  { value: 'system', label: 'System', icon: 'monitor' }]
        })
      }).__html;
    }

    /* ---------- import and reset ---------- */

    function runImport(files) {
      SM.importer.inspect(files).then(function (result) {
        var lines = Object.keys(result.counts).map(function (table) {
          return SM.fmt.plural(result.counts[table], 'row') + ' of ' +
            table.replace('_', ' ');
        });

        SM.ui.openAlert({
          title: 'Import ' + SM.fmt.plural(lines.length, 'file') + '?',
          desc: 'The tables in these files are replaced. Anything not covered by a ' +
                'file is left as it is.',
          confirmLabel: 'Replace and import',
          tone: 'destructive',
          body: raw(html`
            <ul class="info-block" style="list-style:disc;padding-left:1.25rem">
              ${lines.map(function (line) { return raw('<li>' + SM.dom.esc(line) + '</li>'); })}
            </ul>
            ${result.warnings.length ? raw(html`
              <div class="mt-3 warn-block">
                ${result.warnings.map(function (w) {
                  return raw('<div>' + SM.dom.esc(w) + '</div>');
                })}
              </div>`) : ''}
            ${result.skipped.length ? raw(html`
              <p class="mt-3 field-hint">Ignored: ${result.skipped.join('; ')}</p>`) : ''}`),
          onConfirm: function (api) {
            var replaced = SM.importer.apply(result);
            api.close();
            SM.toast.success('Imported', 'Replaced ' + replaced + '.');
            update();
          }
        });
      }).catch(function (err) {
        SM.toast.error('Could not import', String(err.message || err));
      });
    }

    function confirmReset() {
      SM.ui.openAlert({
        title: 'Start again from the seed?',
        desc: 'Everything in this browser is deleted and the five original systems ' +
              'and eight sites come back.',
        confirmLabel: 'Delete and start again',
        tone: 'destructive',
        body: raw('<p class="warn-block">Every check, every edit and every activity ' +
                  'entry is removed. Export first if you want to keep them.</p>'),
        onConfirm: function (api) {
          SM.store.resetToSeed();
          SM.backfill.run();
          SM.storage.flush();
          api.close();
          SM.toast.success('Started again from the seed');
          update();
        }
      });
    }

    /* ---------- events ---------- */

    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="toggle-auto"]', function (e, node) {
      SM.mutate.updateSettings({ auto_sweep_enabled: node.checked ? '1' : '0' }, {
        subject: 'Automatic sweeps ' + (node.checked ? 'switched on' : 'switched off'),
        detail: node.checked
          ? 'Every ' + SM.fmt.plural(SM.store.settingInt('auto_sweep_minutes'), 'minute')
          : 'Nothing is checked automatically'
      });
      SM.scheduler.apply();
      update();
    }));

    /*
      Committed on change rather than on every keystroke, and re-timed
      immediately, so a new interval applies from now instead of after the
      current one has run out.
    */
    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="set-interval"]', function (e, node) {
      SM.mutate.updateSettings({ auto_sweep_minutes: node.value }, {
        subject: 'Sweep interval changed',
        detail: 'Every ' + SM.fmt.plural(parseInt(node.value, 10) || 5, 'minute')
      });
      SM.scheduler.apply();
      update();
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="set-packets"]', function (e, node) {
      SM.mutate.updateSettings({ sweep_packets: node.value });
      update();
    }));
    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="set-timeout"]', function (e, node) {
      SM.mutate.updateSettings({ sweep_timeout_ms: node.value });
      update();
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="export-data"]', function () {
      SM.exports.data();
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="import-data"]', function () {
      var input = SM.dom.qs('#import-input', root);
      if (input) input.click();
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'change', '#import-input', function (e, node) {
      if (node.files && node.files.length) runImport(node.files);
      node.value = '';   /* so choosing the same file twice fires again */
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="reset-data"]', confirmReset));

    /*
      Permission is requested from this click and nowhere else. Asking on page
      load is how a site gets permanently blocked.
    */
    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="toggle-notify"]',
      function (e, node) {
        if (!node.checked) {
          SM.mutate.updateSettings({ notifications_enabled: '0' });
          update();
          return;
        }
        node.checked = false;   /* not on until permission actually says so */
        SM.notify.request().then(function (permission) {
          if (permission === 'granted') {
            SM.mutate.updateSettings({ notifications_enabled: '1' });
            update();
            SM.notify.sample();
          } else {
            update();
            SM.toast.warning('Notifications not allowed',
              permission === 'denied'
                ? 'Your browser has blocked them for this page.'
                : 'The request was dismissed. Try again when you are ready.');
          }
        });
      }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="test-notify"]', function () {
      var sent = SM.notify.sample();
      if (!sent) SM.toast.warning('The browser refused to show it');
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="set-theme"]', function (e, node) {
      SM.theme.set(node.getAttribute('data-value'));
      update();
    }));

    ctx.onCleanup(SM.store.subscribe(['settings', 'checks'], update, { signal: ctx.signal }));

    update();
    return { onParams: update };
  }

  return { mount: mount };
})();
