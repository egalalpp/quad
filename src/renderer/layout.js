// Левую и правую линии можно таскать: меню сжимается до иконок, очередь растёт вместе с обложками.
(() => {
  const KEY = 'quad.layout';
  const DEFAULTS = { nav: 184, queue: 184 };
  const LIMITS = { nav: [72, 340], queue: [28, 560] };

  // Если отпустить линию в этой зоне, панель сама схлопывается до края.
  const COLLAPSE_BELOW = { nav: 128, queue: 96 };
  const MIN_STAGE = 380;
  const SETTLE_MS = 420;

  const root = document.documentElement;
  const app = document.querySelector('.app');
  const handles = document.querySelectorAll('.line-handle');

  let sizes = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? 'null') };

  const other = (side) => (side === 'nav' ? 'queue' : 'nav');

  function clampSize(side, value) {
    const [low, high] = LIMITS[side];
    const room = window.innerWidth - sizes[other(side)] - MIN_STAGE;
    return Math.max(low, Math.min(high, room, value));
  }

  function apply() {
    root.style.setProperty('--nav-w', `${clampSize('nav', sizes.nav)}px`);
    root.style.setProperty('--queue-w', `${clampSize('queue', sizes.queue)}px`);
  }

  function settle() {
    app.classList.add('is-settling');
    apply();
    setTimeout(() => app.classList.remove('is-settling'), SETTLE_MS);
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(sizes));
  }

  handles.forEach((handle) => {
    const { side } = handle.dataset;
    const direction = side === 'nav' ? 1 : -1;
    let startX = 0;
    let startSize = 0;
    let frame = 0;

    handle.addEventListener('pointerdown', (event) => {
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
      startX = event.clientX;
      startSize = clampSize(side, sizes[side]);
    });

    handle.addEventListener('pointermove', (event) => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      sizes[side] = clampSize(side, startSize + (event.clientX - startX) * direction);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });

    const release = () => {
      handle.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing');
      if (sizes[side] < COLLAPSE_BELOW[side]) sizes[side] = LIMITS[side][0];
      settle();
      save();
    };
    handle.addEventListener('pointerup', release);
    handle.addEventListener('pointercancel', release);

    handle.addEventListener('dblclick', () => {
      sizes[side] = DEFAULTS[side];
      settle();
      save();
    });
  });

  window.addEventListener('resize', apply);
  apply();

  window.quadLayout = {
    reset() {
      sizes = { ...DEFAULTS };
      localStorage.removeItem(KEY);
      settle();
    },
  };
})();
