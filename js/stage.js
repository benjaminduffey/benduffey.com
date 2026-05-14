/* benduffey.com — Scroll stage controller.
   Manages the fixed NICE constellation icon, reveal-on-scroll for sections,
   and the side timeline's active state. */
const Stage = (() => {
  let wrap = null;
  let stage = null;
  let items = [];
  let sections = [];
  let ticking = false;

  function _onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      const vh = window.innerHeight;

      // Past the intro: shrink + lift the icon.
      const compact = y > vh * 0.45;
      wrap.classList.toggle('is-compact', compact);

      // Active timeline section — whichever stop's midpoint is closest to viewport center.
      let activeId = sections[0]?.id;
      const probe = vh * 0.45;
      for (const s of sections) {
        if (s.getBoundingClientRect().top <= probe) activeId = s.id;
      }
      for (const it of items) {
        it.classList.toggle('is-active', it.dataset.section === activeId);
      }

      ticking = false;
    });
  }

  function init() {
    wrap = document.querySelector('.bd-mark-wrap');
    stage = document.querySelector('.bd-stage');
    items = Array.from(document.querySelectorAll('.bd-timeline-item'));
    sections = Array.from(document.querySelectorAll('.bd-stop'));
    if (!wrap || !stage || !items.length || !sections.length) return;

    // Reveal stops as they intersect.
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) e.target.classList.add('is-visible');
      }
    }, { threshold: 0.15 });
    sections.forEach((s) => io.observe(s));

    // Smooth-scroll on timeline click.
    items.forEach((it) => {
      it.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.getElementById(it.dataset.section);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    window.addEventListener('scroll', _onScroll, { passive: true });
    _onScroll();
  }

  return { init };
})();
