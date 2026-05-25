/* animations.js — Motion-powered scroll and entrance animations
   Uses the Motion vanilla JS library (global: Motion)
   Respects prefers-reduced-motion. */

(function () {
  if (!window.Motion) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const { animate, inView, stagger } = Motion;

  const ease = [0.16, 1, 0.3, 1]; // expo out — fast then settles

  /* ── Hero entrance (fires once on load) ── */
  const heroTargets = document.querySelectorAll(
    '.hero-eyebrow, .hero h1, .hero-lead, .hero .btn-group, .hero-draft'
  );
  if (heroTargets.length) {
    animate(
      heroTargets,
      { opacity: [0, 1], transform: ['translateY(20px)', 'translateY(0px)'] },
      { delay: stagger(0.1), duration: 0.7, easing: ease }
    );
  }

  /* ── Section labels + titles ── */
  inView('.section-label', ({ target }) => {
    animate(target, { opacity: [0, 1], transform: ['translateY(8px)', 'translateY(0px)'] },
      { duration: 0.45, easing: ease });
  }, { margin: '-8% 0px' });

  inView('h2.section-title, .section-desc', ({ target }) => {
    animate(target, { opacity: [0, 1], transform: ['translateY(12px)', 'translateY(0px)'] },
      { duration: 0.5, easing: ease });
  }, { margin: '-6% 0px' });

  /* ── Thesis / quote blocks ── */
  inView('.thesis-block', ({ target }) => {
    animate(target, { opacity: [0, 1], transform: ['translateY(12px)', 'translateY(0px)'] },
      { duration: 0.55, easing: ease });
  }, { margin: '-6% 0px' });

  /* ── Primitive cards — stagger grid ── */
  inView('.primitives-grid', ({ target }) => {
    animate(
      target.querySelectorAll('.primitive-card'),
      { opacity: [0, 1], transform: ['translateY(24px)', 'translateY(0px)'] },
      { delay: stagger(0.07), duration: 0.55, easing: ease }
    );
  }, { margin: '-4% 0px' });

  /* ── Feature list items ── */
  inView('.feature-list', ({ target }) => {
    animate(
      target.querySelectorAll('li'),
      { opacity: [0, 1], transform: ['translateY(18px)', 'translateY(0px)'] },
      { delay: stagger(0.06), duration: 0.5, easing: ease }
    );
  }, { margin: '-4% 0px' });

  /* ── Spec grid cards ── */
  inView('.spec-grid', ({ target }) => {
    animate(
      target.querySelectorAll('.spec-card'),
      { opacity: [0, 1], transform: ['translateY(24px)', 'translateY(0px)'] },
      { delay: stagger(0.07), duration: 0.5, easing: ease }
    );
  }, { margin: '-4% 0px' });

  /* ── Workflow steps — slide from left ── */
  inView('.workflow-steps', ({ target }) => {
    animate(
      target.querySelectorAll('li'),
      { opacity: [0, 1], transform: ['translateX(-20px)', 'translateX(0px)'] },
      { delay: stagger(0.1), duration: 0.55, easing: ease }
    );
  }, { margin: '-4% 0px' });

  /* ── Tables ── */
  inView('.table-wrap', ({ target }) => {
    animate(target, { opacity: [0, 1], transform: ['translateY(12px)', 'translateY(0px)'] },
      { duration: 0.5, easing: ease });
  }, { margin: '-4% 0px' });

  /* ── Code blocks ── */
  inView('.code-block', ({ target }) => {
    animate(target, { opacity: [0, 1], transform: ['translateY(16px)', 'translateY(0px)'] },
      { duration: 0.55, easing: ease });
  }, { margin: '-4% 0px' });

  /* ── Draft notice ── */
  inView('.draft-notice', ({ target }) => {
    animate(target, { opacity: [0, 1], transform: ['translateX(-12px)', 'translateX(0px)'] },
      { duration: 0.4, easing: ease });
  });

  /* ── Adoption / badge rows ── */
  inView('tbody tr', ({ target }) => {
    animate(target, { opacity: [0, 1] }, { duration: 0.35, delay: 0.05 });
  }, { margin: '-2% 0px' });

  /* ── Spec reader prose ── */
  inView('#spec-content', ({ target }) => {
    animate(target, { opacity: [0, 1], transform: ['translateY(10px)', 'translateY(0px)'] },
      { duration: 0.6, easing: ease });
  });

  /* ── Nav brand ── */
  const navBrand = document.querySelector('.nav-brand');
  if (navBrand) {
    animate(navBrand, { opacity: [0, 1] }, { duration: 0.5, delay: 0.05 });
  }

})();
