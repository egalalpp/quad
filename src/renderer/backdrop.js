// Живой фон один на всё приложение. Видеокарта, детектор и память общие,
// а холст переезжает на тот экран, который сейчас открыт: волну или страницу трека.
(() => {
  // На мониторе 240 Гц фону хватает каждого второго кадра: глазу не заметно, видеокарте вдвое легче.
  const MIN_STEP = 1000 / 125;
  const MAX_STEP = 50;

  // Пауза дольше этого: фон уже потух, рисовать незачем. А ещё дольше: память видеокарты отдаётся.
  const SLEEP_AFTER = 4000;
  const RELEASE_AFTER = 30000;
  const SEEK_WARMUP = 1200;
  const PLACE_EVERY = 250;
  const AMOUNT = { full: 1, soft: 0.4 };

  const root = document.documentElement;
  const canvas = document.createElement('canvas');
  canvas.className = 'live-fx';
  canvas.setAttribute('aria-hidden', 'true');

  const fx = new WaveFx(canvas);
  const pulse = new DropDetector();
  const { audio, beatAnalyser } = quadPlayer;
  const bins = new Uint8Array(beatAnalyser.frequencyBinCount);
  const hzPerBin = beatAnalyser.context.sampleRate / beatAnalyser.fftSize;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const hosts = [];
  let running = false;
  let lastFrame = 0;
  let sinceRender = 0;
  let sincePlace = Infinity;
  let quietFor = 0;
  let trackKey = null;
  let isHolding = false;
  let shownBeat = '';

  const host = () => hosts.at(-1) ?? null;
  const amount = () => (reducedMotion ? 0 : AMOUNT[root.dataset.waveFx] ?? 0);

  function frame(now) {
    if (!running) return;
    const ms = Math.min(now - lastFrame, MAX_STEP);
    lastFrame = now;
    const current = host();

    if (audio.paused) bins.fill(0);
    else beatAnalyser.getByteFrequencyData(bins);
    pulse.update(bins, hzPerBin, ms);
    quietFor = audio.paused ? quietFor + ms : 0;

    const strength = amount();
    hold(strength > 0 && quietFor < RELEASE_AFTER);
    canvas.hidden = strength === 0;
    if (pulse.dropped && strength > 0) document.dispatchEvent(new CustomEvent('quad:drop', { detail: strength }));
    showBeat(current, pulse.kick * (0.4 + 0.6 * pulse.heat) * strength);

    sinceRender += ms;
    sincePlace += ms;
    if (strength > 0 && quietFor < SLEEP_AFTER && sinceRender >= MIN_STEP) {
      if (sincePlace >= PLACE_EVERY) {
        fx.place(current.layout());
        sincePlace = 0;
      }
      fx.render(Math.min(sinceRender, MAX_STEP), pulse, bins, hzPerBin, current.spin?.() ?? 0, strength);
      sinceRender = 0;
    }
    requestAnimationFrame(frame);
  }

  // Удар качает только то, что экран сам попросил, и только когда значение правда поменялось:
  // переменная на большом блоке пересчитывала бы его стили на каждом кадре.
  function showBeat(current, value) {
    const text = value < 0.005 ? '0' : value.toFixed(2);
    if (!current.beat || text === shownBeat) return;
    shownBeat = text;
    current.beat.style.setProperty('--beat', text);
  }

  // Фон выключен в настройках или музыка давно стоит: видеокарта не нужна, её память отдаётся.
  function hold(needed) {
    if (needed === isHolding) return;
    isHolding = needed;
    if (needed) {
      fx.resize(window.innerWidth, window.innerHeight);
      sincePlace = Infinity;
    } else {
      fx.release();
    }
  }

  function start() {
    isHolding = false;
    if (running) return;
    running = true;
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    isHolding = false;
    fx.release();
    canvas.remove();
  }

  // Холст переезжает к последнему открытому экрану, а шлейфы при этом не обрываются.
  function settle() {
    const current = host();
    if (!current) {
      stop();
      return;
    }
    current.mount(canvas);
    sincePlace = Infinity;
    if (!running) start();
  }

  function attach(entry) {
    if (!hosts.includes(entry)) hosts.push(entry);
    settle();
  }

  function detach(entry) {
    const index = hosts.indexOf(entry);
    if (index < 0) return;
    hosts.splice(index, 1);
    entry.beat?.style.removeProperty('--beat');
    shownBeat = '';
    settle();
  }

  // Новый трек сравнивается только сам с собой, а цвет фона берётся с его обложки.
  async function followTrack() {
    const track = quadPlayer.currentTrack();
    const key = track ? `${track.provider}:${track.id}` : null;
    if (key === trackKey) return;
    trackKey = key;
    pulse.reset();

    const tints = track?.cover ? await quadCoverTints(track.cover).catch(() => null) : null;
    if (key !== trackKey) return;
    const accent = window.quadTint.split(',').map(Number);
    fx.setTints(tints?.[0] ?? accent, tints?.[1] ?? accent);
  }

  document.addEventListener('quad:track', followTrack);
  audio.addEventListener('seeked', () => pulse.reset(SEEK_WARMUP));
  window.addEventListener('resize', () => {
    if (!isHolding) return;
    fx.resize(window.innerWidth, window.innerHeight);
    sincePlace = Infinity;
  });

  window.quadBackdrop = { attach, detach, pulse };
})();
