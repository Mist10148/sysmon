/*
  Inline editing, for the Issues and Remarks columns of the monitoring form.

  These two columns are the only free text in the whole application, and they are
  filled in while someone is on the phone to an LHIO. So the cell reads as text
  until it is clicked, and then it is a textarea sized to the cell - not a row of
  input boxes, which would make the form look like a data-entry screen rather
  than a record.

  Enter commits, Shift+Enter adds a line, Escape reverts, and losing focus
  commits, because tabbing to the next cell should keep what was typed.
*/
window.SM = window.SM || {};
SM.ui = SM.ui || {};

(function () {
  'use strict';

  /* The read-only face of the cell. */
  function InlineEdit(opts) {
    var o = opts || {};
    var empty = !o.value;
    return SM.dom.raw('<button type="button" class="inline-edit"' +
      ' data-act="inline-edit"' +
      SM.dom.attr('data-id', o.id) +
      SM.dom.attr('data-field', o.field) +
      SM.dom.attr('data-empty', empty ? 'true' : 'false') +
      SM.dom.attr('aria-label', (o.label || 'Edit') + (o.context ? ' for ' + o.context : '')) +
      '>' + SM.dom.esc(empty ? (o.placeholder || '--') : o.value) + '</button>');
  }

  /*
    Swaps the button for a textarea. onCommit(id, field, value) does the write;
    this function knows nothing about the store.
  */
  function begin(button, onCommit) {
    if (!button || button.dataset.editing === 'true') return;

    var id = parseInt(button.getAttribute('data-id'), 10);
    var field = button.getAttribute('data-field');
    var original = button.dataset.empty === 'true' ? '' : button.textContent;

    var area = document.createElement('textarea');
    area.className = 'inline-edit-field';
    area.value = original;
    area.setAttribute('aria-label', button.getAttribute('aria-label') || 'Edit');

    var holder = button.parentNode;
    button.dataset.editing = 'true';
    button.hidden = true;
    holder.insertBefore(area, button);

    /* Grow to fit what is already there rather than making them scroll it. */
    area.style.height = Math.min(180, Math.max(56, area.scrollHeight + 4)) + 'px';
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);

    var settled = false;

    function finish(commit) {
      if (settled) return;
      settled = true;
      var value = area.value;
      area.remove();
      button.hidden = false;
      delete button.dataset.editing;
      if (commit && value !== original) {
        onCommit(id, field, value);
      } else {
        button.focus();
      }
    }

    area.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();   /* not the dialog's or the drawer's Escape */
        finish(false);
      }
    });

    area.addEventListener('blur', function () { finish(true); });

    area.addEventListener('input', function () {
      area.style.height = 'auto';
      area.style.height = Math.min(180, Math.max(56, area.scrollHeight + 4)) + 'px';
    });
  }

  /* One binding per page; the cells themselves are replaced freely underneath. */
  function bind(root, onCommit) {
    return SM.dom.delegate(root, 'click', '[data-act="inline-edit"]', function (e, node) {
      begin(node, onCommit);
    });
  }

  SM.ui.InlineEdit = InlineEdit;
  SM.ui.bindInlineEdit = bind;
})();
