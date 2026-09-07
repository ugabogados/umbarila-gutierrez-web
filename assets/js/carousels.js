(() => {
  const mobile = matchMedia('(max-width: 760px)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('[data-carousel]').forEach((track) => {
    const cards = [...track.children];
    const controls = document.createElement('div');
    controls.className = 'carousel-controls';
    const hint = document.createElement('span');
    hint.className = 'sr-only';
    hint.textContent = track.dataset.carousel;
    const previous = document.createElement('button');
    const next = document.createElement('button');
    const status = document.createElement('span');
    previous.type = next.type = 'button';
    previous.textContent = '←';
    next.textContent = '→';
    previous.setAttribute('aria-label', 'Anterior: ' + track.dataset.carousel);
    next.setAttribute('aria-label', 'Siguiente: ' + track.dataset.carousel);
    previous.setAttribute('aria-controls', track.id);
    next.setAttribute('aria-controls', track.id);
    status.setAttribute('role', 'status');
    status.className = 'sr-only';
    status.setAttribute('aria-live', 'polite');
    controls.append(hint, previous, status, next);
    track.after(controls);
    let index = 0;
    function update() {
      const left = track.getBoundingClientRect().left;
      index = cards.reduce((best, card, i) =>
        Math.abs(card.getBoundingClientRect().left - left) <
        Math.abs(cards[best].getBoundingClientRect().left - left) ? i : best, 0);
      status.textContent = `${index + 1} / ${cards.length}`;
      previous.disabled = index === 0;
      next.disabled = index === cards.length - 1;
    }
    function move(to) {
      const card = cards[Math.max(0, Math.min(cards.length - 1, to))];
      track.scrollTo({left: track.scrollLeft + card.getBoundingClientRect().left - track.getBoundingClientRect().left,
        behavior: reducedMotion.matches ? 'instant' : 'smooth'});
    }
    previous.addEventListener('click', () => move(index - 1));
    next.addEventListener('click', () => move(index + 1));
    track.addEventListener('keydown', (event) => {
      if (!mobile.matches || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      move(event.key === 'Home' ? 0 : event.key === 'End' ? cards.length - 1 : index + (event.key === 'ArrowRight' ? 1 : -1));
    });
    let frame;
    track.addEventListener('scroll', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }, {passive: true});
    function configure() {
      controls.hidden = !mobile.matches;
      if (mobile.matches) {
        track.tabIndex = 0;
        track.setAttribute('aria-label', track.dataset.carousel + '. Desliza o usa las flechas para explorar.');
      } else {
        track.removeAttribute('tabindex');
        track.removeAttribute('aria-label');
        track.scrollLeft = 0;
      }
      update();
    }
    mobile.addEventListener('change', configure);
    new ResizeObserver(update).observe(track);
    configure();
  });
})();
