/* Instrument picker behavior in the actual analyzer renderer. */
'use strict';
module.exports = function checkInstrumentDialog() {
  const $ = id => document.getElementById(id), check = (ok, why) => { if (!ok) throw Error(why); };
  const dialog = $('az-tools-dialog'), tools = $('az-tools'), confirm = $('az-tools-confirm'), search = $('az-tools-search');
  const crown = tools.querySelector('[data-tool="crown"]');
  const originallyHeld = crown.getAttribute('aria-pressed');
  const filter = query => { search.value = query; search.dispatchEvent(new Event('input', { bubbles: true })); };
  const enter = () => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  $('az-tools-open').click();
  check(dialog.open && dialog.contains(tools) && dialog.contains(confirm), 'Instrument controls did not move into the dialog');
  check(document.activeElement === search, 'Search did not receive focus');
  filter('  CROWN  ');
  check([...tools.querySelectorAll('[data-tool]')].filter(b => !b.hidden).map(b => b.dataset.tool).join() === 'crown', 'Case-insensitive instrument search failed');
  enter(); check(crown.getAttribute('aria-pressed') !== originallyHeld, 'Enter failed to pick the only visible instrument');
  enter(); check(crown.getAttribute('aria-pressed') === originallyHeld, 'Instrument toggle could not be reversed');
  filter('no-instrument-has-this-name'); enter();
  check(crown.getAttribute('aria-pressed') === originallyHeld, 'An empty search picked a hidden instrument');
  dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  check(!dialog.open && tools.parentElement === $('az-tools-open').parentElement && !dialog.contains(confirm), 'Escape failed to restore instrument controls');
  check([...tools.querySelectorAll('[data-tool]')].every(b => !b.hidden), 'Search filtering leaked after closing');
  $('az-tools-open').click(); $('az-tools-close').click();
  check(!dialog.open, 'Done failed to close the dialog');
  $('az-tools-open').click(); $('az-tools-ok').click();
  check(!dialog.open && !TartarusAnalyzer.desktopSnapshot().toolsConfirm, 'These are right did not close and confirm');
  for (const id of ['az-tools', 'az-tools-confirm', 'az-tools-ok']) check(document.querySelectorAll('#' + id).length === 1, 'Duplicated instrument control: ' + id);
  const start = $('az-start-event');
  for (const id of ['maiden', 'scapegoat']) {
    const b = tools.querySelector(`[data-tool="${id}"]`);
    if (b.getAttribute('aria-pressed') !== 'true') b.click();
  }
  start.value = 'ironlaw'; start.dispatchEvent(new Event('change'));
  const notes = $('az-play-notes-list');
  check(!$('az-play-notes').hidden && notes.textContent.includes('Iron Law') && notes.textContent.includes('before the Scapegoat'), 'Instrument pair/contract notes were not rendered');
  const first = notes.firstElementChild;
  start.dispatchEvent(new Event('change'));
  check(notes.firstElementChild === first, 'Unchanged notes were rebuilt');
  start.value = 'cagefight'; start.dispatchEvent(new Event('change'));
  check(notes.textContent.includes('Cage Fight') && !notes.textContent.includes('Iron Law'), 'Changing the contract left stale notes');
  return { search: true, enter: true, escape: true, done: true, confirmation: true, controlsRetained: true, strategyNotes: true, notesDomReused: true };
};
