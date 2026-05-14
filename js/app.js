/* benduffey.com — App orchestrator
   Boots theme + chat, wires the mobile sidebar toggle, adds a backdrop
   element so tapping outside the open sidebar closes it. */
(() => {
  function init() {
    Theme.init();
    Chat.init();
    _wireMobileSidebar();
  }

  function _wireMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('btn-sidebar-toggle');
    if (!sidebar || !toggle) return;

    // Inject backdrop once. Append to <body> (not into .app) so it doesn't
    // become a grid child and disrupt the sidebar/chat column layout.
    let backdrop = document.querySelector('.sidebar-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'sidebar-backdrop';
      document.body.appendChild(backdrop);
    }

    function open() { sidebar.classList.add('is-open'); document.body.classList.add('sidebar-open'); }
    function close() { sidebar.classList.remove('is-open'); document.body.classList.remove('sidebar-open'); }

    toggle.addEventListener('click', () => {
      sidebar.classList.contains('is-open') ? close() : open();
    });
    backdrop.addEventListener('click', close);

    // Close when picking a chat or starting a new one (mobile only).
    document.getElementById('chat-list')?.addEventListener('click', (e) => {
      if (window.matchMedia('(max-width: 768px)').matches && e.target.closest('.chat-item')) close();
    });
    document.getElementById('btn-new-chat')?.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 768px)').matches) close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
