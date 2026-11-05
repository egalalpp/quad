// Экран волны: та же сцена, что в заставке, только в центре вместо логотипа играющий трек.
(() => {
  const { GATHER } = StringsScene;
  const START_CLOCK = GATHER - 700;
  const CONTENT_AT = GATHER + 500;

  // К этому моменту звёзды разлетелись, а струны стоят на месте.
  const SETTLED_CLOCK = GATHER + StringsScene.DUST_SETTLE;

  // Каждая струна показывает свою полосу спектра: сверху бас, дальше по часовой стрелке выше.
  // Чем выше полоса, тем мельче и быстрее рябь на струне.
  const BANDS = [
    { from: 40, to: 180, ripples: 1.5, speed: 0.004, gain: 1 },
    { from: 180, to: 800, ripples: 2.5, speed: 0.006, gain: 1.1 },
    { from: 800, to: 3500, ripples: 4, speed: 0.009, gain: 1.5 },
    { from: 3500, to: 14000, ripples: 6, speed: 0.012, gain: 2.2 },
  ];
  const MAX_SWING = 16;
  const ATTACK = 0.5;
  const RELEASE = 0.88;

  // Дрожь фона: только резкие подъёмы баса, а не его средний уровень.
  const KICK_BINS_HZ = [40, 140];
  const KICK_GAIN = 5;
  const KICK_DECAY = 0.82;
  const BASS_MEMORY = 0.97;
  const SHAKE_PX = 3.5;
  const PULSE = 0.035;

  const view = document.getElementById('view-wave');
  const center = document.getElementById('wave-center');
  const cover = document.getElementById('wave-cover');
  const title = document.getElementById('wave-title');
  const artists = document.getElementById('wave-artists');
  const startButton = document.getElementById('wave-start');
  const navItem = document.querySelector('[data-view="wave"]');
  const scene = new StringsScene(document.getElementById('wave-canvas'));
  const { audio, analyser } = quadPlayer;

  const bins = new Uint8Array(analyser.frequencyBinCount);
  const hzPerBin = analyser.context.sampleRate / analyser.fftSize;
  const levels = BANDS.map(() => new Float32Array(StringsScene.POINTS));
  const phases = BANDS.map(() => 0);

  let running = false;
  let lastFrame = 0;
  let bassAverage = 0;
  let kick = 0;
  let shownKey = null;

  function layout() {
    const edge = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--edge'));
    const width = window.innerWidth;
    const height = window.innerHeight;
    const free = height - edge - 40;
    const half = Math.round(Math.min(width * 0.36, free * 0.74, 400) / 2);
    const centerX = Math.round(width / 2);
    const centerY = Math.round(40 + free / 2);

    scene.setBounds(width, height, centerX, centerY, half);
    view.style.setProperty('--center-x', `${centerX}px`);
    view.style.setProperty('--center-y', `${centerY}px`);
    view.style.setProperty('--half', `${half}px`);
    view.style.setProperty('--cover-size', `${Math.round(half * 0.98)}px`);
  }

  // Вдоль струны идёт её полоса спектра: от центра к концам частота растёт.
  function driveStrings(ms) {
    if (scene.reducedMotion) return;
    if (audio.paused) bins.fill(0);
    else analyser.getByteFrequencyData(bins);

    const attack = 1 - ATTACK ** (ms / 16.7);
    const release = 1 - RELEASE ** (ms / 16.7);
    const last = StringsScene.POINTS - 1;

    BANDS.forEach((band, index) => {
      const firstBin = band.from / hzPerBin;
      const lastBin = band.to / hzPerBin;
      const level = levels[index];
      const swing = scene.strings[index].audio;
      phases[index] += band.speed * ms;

      for (let i = 0; i <= last; i += 1) {
        const x = i / last;
        const bin = firstBin * (lastBin / firstBin) ** Math.abs(2 * x - 1);
        const target = (bins[Math.round(bin)] / 255) ** 2 * band.gain;
        level[i] += (target - level[i]) * (target > level[i] ? attack : release);

        const ripple = Math.sin(2 * Math.PI * band.ripples * x + phases[index]);
        swing[i] = Math.min(1, level[i]) * MAX_SWING * Math.sin(Math.PI * x) * ripple;
      }
    });
  }

  function shakeBackground(ms) {
    if (scene.reducedMotion) return;

    const first = Math.round(KICK_BINS_HZ[0] / hzPerBin);
    const last = Math.round(KICK_BINS_HZ[1] / hzPerBin);
    let sum = 0;
    for (let i = first; i <= last; i += 1) sum += bins[i];
    const bass = sum / (last - first + 1) / 255;

    bassAverage += (bass - bassAverage) * (1 - BASS_MEMORY ** (ms / 16.7));
    const hit = Math.min(1, Math.max(0, bass - bassAverage) * KICK_GAIN);
    kick = Math.max(hit, kick * KICK_DECAY ** (ms / 16.7));

    scene.shakeX = (Math.random() - 0.5) * 2 * kick * SHAKE_PX;
    scene.shakeY = (Math.random() - 0.5) * 2 * kick * SHAKE_PX;
    scene.pulse = 1 + kick * PULSE;
    view.style.setProperty('--kick', kick.toFixed(3));
  }

  function frame(now) {
    if (!running) return;
    const ms = Math.min(now - lastFrame, 50);
    lastFrame = now;

    // Страница трека закрывает сцену полностью: рисовать незачем, кадры нужны тексту.
    if (document.body.classList.contains('page-open')) {
      requestAnimationFrame(frame);
      return;
    }

    driveStrings(ms);
    shakeBackground(ms);
    scene.beginFrame(ms);
    scene.runPlucks();
    scene.idlePluck();
    scene.drawEffects(ms, 1);
    scene.drawQuad();

    if (scene.clock >= CONTENT_AT) view.classList.add('is-ready');
    requestAnimationFrame(frame);
  }

  function renderTrack() {
    const track = quadWave.isActive() ? quadPlayer.currentTrack() : null;
    view.classList.toggle('has-track', Boolean(track));
    if (!track) return;

    const key = `${track.provider}:${track.id}`;
    if (key === shownKey) return;
    shownKey = key;

    // Смена трека перезапускает плавное появление, а струны вздрагивают.
    center.classList.remove('is-changing');
    center.getBoundingClientRect();
    center.classList.add('is-changing');

    if (track.coverLarge) cover.src = track.coverLarge;
    else cover.removeAttribute('src');
    title.textContent = track.title;
    quadPlayer.renderArtistLinks(artists, track);
    if (running) scene.pluckAll(9);
  }

  // Вход при играющей волне: сцена просто продолжается, без сборки звёзд и вспышки.
  function resume() {
    if (scene.dust.length === 0) scene.reset(SETTLED_CLOCK);
    scene.clock = Math.max(scene.clock, SETTLED_CLOCK);
    scene.plucksDone = scene.strings.length;
    view.classList.add('is-ready', 'is-resumed');
    center.classList.remove('is-changing');
  }

  function playEntrance() {
    view.classList.remove('is-ready', 'is-resumed');
    scene.reset(START_CLOCK);
  }

  function open() {
    if (running) return;
    running = true;
    layout();

    if (quadWave.isActive()) resume();
    else playEntrance();

    scene.nextIdlePluck = scene.clock + 1800;
    renderTrack();
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  function close() {
    if (running) scene.release();
    running = false;
  }

  document.addEventListener('quad:view', ({ detail }) => {
    if (detail === 'wave') open();
    else close();
  });

  // Не перебиваем то, что уже играет: тогда волна запускается кнопкой.
  navItem.addEventListener('click', () => {
    if (!quadWave.isActive() && audio.paused) quadWave.start();
  });

  startButton.addEventListener('click', () => quadWave.start());
  cover.addEventListener('click', () => document.getElementById('now-cover').click());
  document.addEventListener('quad:track', renderTrack);

  window.addEventListener('pointermove', (event) => {
    if (running) scene.pluckOnCrossing(event);
  });
  window.addEventListener('resize', () => {
    if (running) layout();
  });
})();
