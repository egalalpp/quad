(() => {
  const STORAGE_KEY = 'quad.introSeen';

  const { GATHER, LINE_ALPHA } = StringsScene;
  const WORD_AT = GATHER + 700;
  const READY_AT = GATHER + 1900;
  const MORPH = 1150;
  const FADE_OUT = 500;
  const APP_LINE_ALPHA = 0.16;

  // Короткая заставка при повторном запуске: тот же таймлайн, но со второй половины сбора пыли.
  const SPLASH_START = GATHER - 700;
  const SPLASH_LEAVE_AT = WORD_AT + 1250;

  const root = document.getElementById('intro');
  const connect = document.getElementById('connect');
  const note = document.getElementById('connect-note');
  const app = document.querySelector('.app');
  const stage = document.querySelector('.stage');
  const appLines = ['.line-top', '.line-right', '.line-bottom', '.line-left']
    .map((selector) => document.querySelector(selector));
  const scene = new StringsScene(document.getElementById('intro-canvas'));

  let running = false;
  let frameId = 0;
  let lastFrame = 0;
  let splash = false;
  let leaveStartedAt = null;
  let finished = false;
  let targetEnds = [];
  let targetShift = 0;

  const lerp = (from, to, t) => from + (to - from) * t;
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  // offset* не зависят от CSS-анимации линий, в отличие от getBoundingClientRect.
  function measureAppLines() {
    const box = stage.getBoundingClientRect();
    return appLines.map((line, index) => {
      const x = box.left + line.offsetLeft;
      const y = box.top + line.offsetTop;
      const ends = line.offsetWidth > line.offsetHeight
        ? [x, y + 0.5, x + line.offsetWidth, y + 0.5]
        : [x + 0.5, y, x + 0.5, y + line.offsetHeight];
      return index < 2 ? ends : [ends[2], ends[3], ends[0], ends[1]];
    });
  }

  function layout() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const titlebar = 40;
    const bottom = splash ? titlebar : connect.offsetHeight + 28;
    const free = height - bottom - titlebar;
    const half = Math.round(Math.min(width * 0.3, free * 0.66, 290) / 2);
    const centerX = Math.round(width / 2);
    const centerY = Math.round(titlebar + free / 2);

    scene.setBounds(width, height, centerX, centerY, half);
    root.style.setProperty('--center-x', `${centerX}px`);
    root.style.setProperty('--center-y', `${centerY}px`);
    root.style.setProperty('--mark-width', `${Math.round(half * 0.98)}px`);
    targetEnds = measureAppLines();
  }

  function drawStrings() {
    if (leaveStartedAt === null) {
      scene.drawQuad();
      return;
    }

    const morph = easeInOutCubic(StringsScene.clamp01((scene.clock - leaveStartedAt) / MORPH));
    scene.quadEnds(scene.half).forEach((ends, index) => {
      const target = targetEnds[(index + targetShift) % scene.strings.length];
      const blended = ends.map((value, i) => lerp(value, target[i], morph));
      scene.drawLine(blended, lerp(LINE_ALPHA, APP_LINE_ALPHA, morph), scene.strings[index], 1 - morph);
    });
  }

  function runTimeline() {
    scene.runPlucks();
    if (scene.clock >= WORD_AT) root.classList.add('is-word');

    if (splash) {
      if (scene.clock >= SPLASH_LEAVE_AT) leave();
      return;
    }

    if (scene.clock >= READY_AT) root.classList.add('is-ready');
    if (leaveStartedAt === null) scene.idlePluck();
  }

  function frame(now) {
    const ms = Math.min(now - lastFrame, 50);
    lastFrame = now;

    scene.beginFrame(ms);
    runTimeline();

    const leaving = leaveStartedAt === null
      ? 0
      : StringsScene.clamp01((scene.clock - leaveStartedAt) / (MORPH * 0.6));
    scene.drawEffects(ms, 1 - leaving);
    drawStrings();

    if (leaveStartedAt !== null && !finished && scene.clock - leaveStartedAt >= MORPH) finish();
    if (running) frameId = requestAnimationFrame(frame);
  }

  /* Переходы */

  function start(mode) {
    running = true;
    finished = false;
    splash = mode === 'splash';
    leaveStartedAt = null;
    targetShift = 0;

    note.textContent = '';
    root.hidden = false;
    root.classList.remove('is-word', 'is-ready', 'is-leaving', 'is-gone');
    document.body.classList.add('intro-active');
    app.inert = true;

    layout();
    scene.reset(splash ? SPLASH_START : 0);
    scene.nextIdlePluck = READY_AT + 1800;

    if (scene.reducedMotion) {
      scene.clock = READY_AT + 1600;
      scene.plucksDone = scene.strings.length;
    }

    lastFrame = performance.now();
    frameId = requestAnimationFrame(frame);
  }

  function skip() {
    if (!running || leaveStartedAt !== null) return;
    if (splash) {
      scene.clock = Math.max(scene.clock, WORD_AT);
      leave();
    } else if (scene.clock < READY_AT) {
      scene.clock = READY_AT;
    }
  }

  function leave() {
    if (!running || leaveStartedAt !== null) return;
    leaveStartedAt = scene.reducedMotion ? scene.clock - MORPH : scene.clock;
    targetEnds = measureAppLines();
    const quarterTurns = Math.round(scene.quadAngle() / (Math.PI / 2));
    const count = scene.strings.length;
    targetShift = ((quarterTurns % count) + count) % count;
    root.classList.add('is-leaving');
    scene.strings.forEach((string, index) => scene.pluck(string, 0.5, index % 2 === 0 ? 9 : -9));
    localStorage.setItem(STORAGE_KEY, '1');
  }

  function finish() {
    finished = true;
    document.body.classList.remove('intro-active');
    app.inert = false;
    root.classList.add('is-gone');
    setTimeout(() => {
      running = false;
      cancelAnimationFrame(frameId);
      root.hidden = true;
      scene.release();
    }, FADE_OUT);
  }

  /* Ввод */

  root.addEventListener('pointermove', (event) => {
    if (leaveStartedAt === null) scene.pluckOnCrossing(event);
  });
  root.addEventListener('pointerdown', skip);
  document.documentElement.addEventListener('pointerleave', () => {
    scene.pointer = null;
  });

  document.addEventListener('keydown', (event) => {
    if (!running) return;
    if (event.key === 'Escape' && scene.clock >= READY_AT) leave();
    else skip();
  });

  document.querySelectorAll('.service').forEach((button, index) => {
    button.addEventListener('pointerenter', () => {
      scene.pluckAt(index % scene.strings.length, 0.3 + Math.random() * 0.4, 5);
    });

    button.addEventListener('pointermove', (event) => {
      const box = button.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      button.style.setProperty('--shift-x', `${(x - box.width / 2) * 0.12}px`);
      button.style.setProperty('--shift-y', `${(y - box.height / 2) * 0.18}px`);
      button.style.setProperty('--light-x', `${x}px`);
      button.style.setProperty('--light-y', `${y}px`);
    });

    button.addEventListener('pointerleave', () => {
      button.style.setProperty('--shift-x', '0px');
      button.style.setProperty('--shift-y', '0px');
    });

    button.addEventListener('click', () => scene.pluckAll(8));
  });

  document.getElementById('intro-later').addEventListener('click', leave);
  document.getElementById('replay-intro').addEventListener('click', () => start('full'));

  window.addEventListener('resize', () => {
    if (running) layout();
  });

  start(localStorage.getItem(STORAGE_KEY) ? 'splash' : 'full');
})();
