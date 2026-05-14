/* benduffey.com — Theme switcher
   - 11 themes vendored from NICE (themes.css owns the variable values)
   - Persists to localStorage 'benduffey-theme'
   - Renders a dropdown menu at #theme-menu, swatches show the accent color */
const Theme = (() => {
  const KEY = 'benduffey-theme';
  const DEFAULT = 'nice';

  // Keep this list in sync with [data-theme="..."] blocks in css/themes.css.
  // The label is what visitors see in the menu; the swatch is read from the
  // theme's --accent at runtime, so colors stay accurate even after edits.
  const THEMES = [
    { id: 'nice',       label: 'NICE' },
    { id: 'nice-dark',  label: 'NICE Dark' },
    { id: 'hal-9000',   label: 'HAL-9000' },
    { id: 'grid',       label: 'The Grid' },
    { id: 'matrix',     label: 'The Matrix' },
    { id: 'lcars',      label: 'LCARS' },
    { id: 'jarvis',     label: 'J.A.R.V.I.S.' },
    { id: 'cyberpunk',  label: 'Cyberpunk' },
    { id: 'rx-78-2',    label: 'RX-78-2' },
    { id: '16bit',      label: '16-BIT' },
    { id: 'office',     label: 'The Office' },
  ];

  function _read() {
    try { return localStorage.getItem(KEY) || DEFAULT; } catch { return DEFAULT; }
  }
  function _save(id) {
    try { localStorage.setItem(KEY, id); } catch {}
  }

  function set(id) {
    const valid = THEMES.find((t) => t.id === id) ? id : DEFAULT;
    document.body.setAttribute('data-theme', valid);
    _save(valid);
    _renderMenu();
  }
  function current() { return document.body.getAttribute('data-theme') || DEFAULT; }
  function cycle() {
    const idx = THEMES.findIndex((t) => t.id === current());
    set(THEMES[(idx + 1) % THEMES.length].id);
  }

  // Resolve the swatch color by reading --accent from a probe div with the
  // target theme applied. Avoids hard-coding accent values in two places.
  function _accentFor(id) {
    const probe = document.createElement('div');
    probe.setAttribute('data-theme', id);
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:1px;height:1px;';
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).getPropertyValue('--accent').trim();
    probe.remove();
    return accent || '#000';
  }

  function _renderMenu() {
    const menu = document.getElementById('theme-menu');
    if (!menu) return;
    const cur = current();
    menu.innerHTML = THEMES.map((t) => `
      <button type="button" class="theme-option ${t.id === cur ? 'is-active' : ''}" data-theme="${t.id}" role="menuitem">
        <span class="theme-swatch" style="background:${_accentFor(t.id)}"></span>
        <span class="theme-option-label">${t.label}</span>
        <i class="fa-solid fa-check theme-option-check"></i>
      </button>
    `).join('');
  }

  function _toggleMenu(force) {
    const menu = document.getElementById('theme-menu');
    if (!menu) return;
    const willOpen = force === true || (force == null && menu.hasAttribute('hidden'));
    if (willOpen) menu.removeAttribute('hidden');
    else menu.setAttribute('hidden', '');
  }

  function init() {
    set(_read());

    const btn = document.getElementById('btn-theme');
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      _toggleMenu();
    });

    document.addEventListener('click', (e) => {
      const menu = document.getElementById('theme-menu');
      if (!menu || menu.hasAttribute('hidden')) return;
      const opt = e.target.closest('.theme-option');
      if (opt) {
        set(opt.dataset.theme);
        _toggleMenu(false);
        return;
      }
      if (!e.target.closest('.theme-cycler')) _toggleMenu(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') _toggleMenu(false);
    });
  }

  return { init, set, current, cycle, THEMES };
})();
