/* benduffey.com — Light / dark theme toggle.
   Mirrors nicespaceship.com (www/js/theme-lite.js): light is the default,
   the user's choice persists, and the Sapphire accent stays constant
   across both modes. Event delegation on `.theme-toggle` means the button
   can mount before or after init() with no race. */
const Theme = (() => {
  const KEY = 'benduffey-theme';

  function _read() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  }
  function _save(theme) {
    try { localStorage.setItem(KEY, theme); } catch {}
  }
  function _syncIcon(theme) {
    const cls = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    document.querySelectorAll('.theme-toggle i').forEach((i) => { i.className = cls; });
  }
  function _apply(theme) {
    document.body.setAttribute('data-theme', theme);
    _syncIcon(theme);
  }

  function init() {
    _apply(_read() === 'dark' ? 'dark' : 'light');
    document.addEventListener('click', (e) => {
      if (e.target.closest('.theme-toggle')) toggle();
    });
  }
  function toggle() {
    const next = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    _apply(next);
    _save(next);
  }
  function current() {
    return document.body.getAttribute('data-theme') || 'light';
  }
  function set(theme) {
    _apply(theme);
    _save(theme);
  }

  return { init, set, toggle, current };
})();
