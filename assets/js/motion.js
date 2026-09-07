(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(({target, isIntersecting}) => {
      if (!isIntersecting) return;
      observer.unobserve(target);
      if (reduced.matches) return;
      target.classList.add('motion-enter');
      target.addEventListener('animationend', () => target.classList.remove('motion-enter'), {once: true});
    });
  }, {threshold: .12});
  document.querySelectorAll('.hero-copy, .hero-aside, .section-heading, .service, .principles > div, .steps > li, .feedback-form, .contact-form').forEach(el => observer.observe(el));
  reduced.addEventListener('change', () => {
    if (!reduced.matches) return;
    observer.disconnect();
    document.querySelectorAll('.motion-enter').forEach(el => el.classList.remove('motion-enter'));
  });
})();
