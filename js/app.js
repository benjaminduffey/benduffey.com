/* benduffey.com — App orchestrator
   Boots theme + chat, wires the sidebar: desktop collapse (persisted) and
   the mobile drawer with a tap-outside backdrop. */
(() => {
  function init() {
    Theme.init();
    Chat.init();
    _wireSidebar();
  }

  function _wireSidebar() {
    const sidebar = document.getElementById('sidebar');
    const collapseBtn = document.getElementById('btn-sidebar-collapse');
    const showBtn = document.getElementById('btn-sidebar-toggle');
    if (!sidebar) return;

    const COLLAPSE_KEY = 'benduffey-sidebar-collapsed';
    const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

    // Backdrop for the mobile drawer — appended to <body> (not into .app) so it
    // doesn't become a grid child and disrupt the sidebar/chat columns.
    let backdrop = document.querySelector('.sidebar-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'sidebar-backdrop';
      document.body.appendChild(backdrop);
    }

    // Restore the desktop collapsed state.
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === '1') document.body.classList.add('sidebar-collapsed');
    } catch {}

    function setCollapsed(on) {
      document.body.classList.toggle('sidebar-collapsed', on);
      try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch {}
    }
    function openDrawer() {
      sidebar.classList.add('is-open');
      document.body.classList.add('sidebar-open');
    }
    function closeDrawer() {
      sidebar.classList.remove('is-open');
      document.body.classList.remove('sidebar-open');
    }

    // Collapse button (in the sidebar): desktop collapses, mobile closes the drawer.
    collapseBtn?.addEventListener('click', () => {
      isMobile() ? closeDrawer() : setCollapsed(true);
    });
    // Show button (in the chat header): desktop expands, mobile opens the drawer.
    showBtn?.addEventListener('click', () => {
      isMobile() ? openDrawer() : setCollapsed(false);
    });
    backdrop.addEventListener('click', closeDrawer);

    // On mobile, picking a chat or starting a new one closes the drawer.
    document.getElementById('chat-list')?.addEventListener('click', (e) => {
      if (isMobile() && e.target.closest('.chat-item')) closeDrawer();
    });
    document.getElementById('btn-new-chat')?.addEventListener('click', () => {
      if (isMobile()) closeDrawer();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
