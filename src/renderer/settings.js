(() => {
  const EQ_KEY = 'quad.equalizer';
  const DEVICE_KEY = 'quad.outputDevice';

  const BANDS = [60, 150, 400, 1000, 2400, 6000, 10000, 15000];
  const MAX_GAIN = 12;
  const PRESETS = {
    Ровно: [0, 0, 0, 0, 0, 0, 0, 0],
    Бас: [7, 5, 2, 0, 0, 0, 0, 0],
    Вокал: [-2, -1, 1, 3, 4, 2, 0, 0],
    Яркий: [0, 0, 0, 1, 2, 4, 5, 6],
    Ночь: [3, 2, 1, 0, -1, -2, -3, -4],
  };

  // Размеры графика в единицах его viewBox.
  const WIDTH = 800;
  const HEIGHT = 220;
  const SIDE = 40;
  const LABEL_SPACE = 26;

  const SVG = 'http://www.w3.org/2000/svg';
  const curve = document.getElementById('eq-curve');
  const toggle = document.getElementById('eq-toggle');
  const presets = document.getElementById('eq-presets');
  const devicesBox = document.getElementById('devices');
  const playlistForm = document.getElementById('playlist-form');
  const playlistInput = document.getElementById('playlist-input');
  const playlistList = document.getElementById('playlist-list');
  const navItem = document.querySelector('[data-view="settings"]');
  const { audio } = quadPlayer;

  const saved = JSON.parse(localStorage.getItem(EQ_KEY) ?? 'null');
  let gains = saved?.gains ?? [...PRESETS.Ровно];
  let enabled = saved?.enabled ?? false;

  /* Звук */

  const context = new AudioContext();
  const filters = BANDS.map((frequency, index) => {
    const filter = context.createBiquadFilter();
    filter.frequency.value = frequency;
    filter.Q.value = 1;
    if (index === 0) filter.type = 'lowshelf';
    else if (index === BANDS.length - 1) filter.type = 'highshelf';
    else filter.type = 'peaking';
    return filter;
  });

  [context.createMediaElementSource(audio), ...filters, context.destination]
    .reduce((from, to) => from.connect(to));

  // По нему экран волны слышит музыку.
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.6;
  analyser.minDecibels = -85;
  analyser.maxDecibels = -15;
  filters.at(-1).connect(analyser);
  quadPlayer.analyser = analyser;

  audio.addEventListener('play', () => context.resume());

  function applyGains() {
    filters.forEach((filter, index) => {
      filter.gain.setTargetAtTime(enabled ? gains[index] : 0, context.currentTime, 0.02);
    });
  }

  function saveEqualizer() {
    localStorage.setItem(EQ_KEY, JSON.stringify({ gains, enabled }));
  }

  /* График */

  const bandX = (index) => SIDE + (index * (WIDTH - SIDE * 2)) / (BANDS.length - 1);
  const graphHeight = HEIGHT - LABEL_SPACE;
  const gainY = (gain) => graphHeight / 2 - (gain / MAX_GAIN) * (graphHeight / 2 - 12);

  function svg(tag, attributes, text) {
    const node = document.createElementNS(SVG, tag);
    Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Плавная кривая через все точки (сплайн Катмулла-Рома в виде кривых Безье).
  function curvePath() {
    const points = gains.map((gain, index) => [bandX(index), gainY(gain)]);
    let path = `M${points[0][0]} ${points[0][1]}`;
    for (let i = 0; i < points.length - 1; i += 1) {
      const before = points[Math.max(i - 1, 0)];
      const from = points[i];
      const to = points[i + 1];
      const after = points[Math.min(i + 2, points.length - 1)];
      const first = [from[0] + (to[0] - before[0]) / 6, from[1] + (to[1] - before[1]) / 6];
      const second = [to[0] - (after[0] - from[0]) / 6, to[1] - (after[1] - from[1]) / 6];
      path += ` C${first[0]} ${first[1]} ${second[0]} ${second[1]} ${to[0]} ${to[1]}`;
    }
    return path;
  }

  function frequencyLabel(frequency) {
    return frequency >= 1000 ? `${frequency / 1000}к` : String(frequency);
  }

  function renderCurve() {
    curve.classList.toggle('is-off', !enabled);
    curve.replaceChildren(
      svg('line', { class: 'eq-zero', x1: SIDE, x2: WIDTH - SIDE, y1: gainY(0), y2: gainY(0) }),
      svg('path', { class: 'eq-line', d: curvePath() }),
      ...gains.flatMap((gain, index) => [
        svg('circle', { class: 'eq-knob', cx: bandX(index), cy: gainY(gain), r: 5 }),
        svg('text', { class: 'eq-label', x: bandX(index), y: HEIGHT - 6 }, frequencyLabel(BANDS[index])),
      ]),
    );
  }

  function renderPresets() {
    [...presets.children].forEach((button) => {
      const same = PRESETS[button.textContent].every((gain, index) => gain === gains[index]);
      button.classList.toggle('is-active', same);
    });
  }

  function renderToggle() {
    toggle.classList.toggle('is-on', enabled);
    toggle.setAttribute('aria-checked', String(enabled));
  }

  function changed() {
    applyGains();
    saveEqualizer();
    renderCurve();
    renderPresets();
    renderToggle();
  }

  function dragBand(event, band) {
    const box = curve.getBoundingClientRect();
    const y = ((event.clientY - box.top) / box.height) * HEIGHT;
    const gain = ((graphHeight / 2 - y) / (graphHeight / 2 - 12)) * MAX_GAIN;
    gains[band] = Math.round(Math.max(-MAX_GAIN, Math.min(MAX_GAIN, gain)) * 2) / 2;
    enabled = true;
    changed();
  }

  let dragging = null;

  curve.addEventListener('pointerdown', (event) => {
    const box = curve.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * WIDTH;
    const distances = BANDS.map((_band, index) => Math.abs(bandX(index) - x));
    dragging = distances.indexOf(Math.min(...distances));
    curve.setPointerCapture(event.pointerId);
    dragBand(event, dragging);
  });
  curve.addEventListener('pointermove', (event) => {
    if (dragging !== null) dragBand(event, dragging);
  });
  curve.addEventListener('pointerup', () => {
    dragging = null;
  });

  toggle.addEventListener('click', () => {
    enabled = !enabled;
    changed();
  });

  presets.append(...Object.entries(PRESETS).map(([name, values]) => {
    const button = document.createElement('button');
    button.className = 'recent-chip';
    button.textContent = name;
    button.addEventListener('click', () => {
      gains = [...values];
      enabled = true;
      changed();
    });
    return button;
  }));

  /* Устройство вывода */

  async function useDevice(deviceId) {
    await context.setSinkId(deviceId);
    localStorage.setItem(DEVICE_KEY, deviceId);
  }

  async function renderDevices() {
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === 'audiooutput' && device.deviceId !== 'communications');
    const current = localStorage.getItem(DEVICE_KEY) ?? 'default';

    devicesBox.replaceChildren(...devices.map((device, index) => {
      const row = document.createElement('button');
      row.className = 'device-row';
      row.classList.toggle('is-active', device.deviceId === current);
      row.textContent = device.deviceId === 'default'
        ? 'Как в системе'
        : device.label || `Устройство ${index + 1}`;
      row.addEventListener('click', async () => {
        await useDevice(device.deviceId === 'default' ? '' : device.deviceId);
        localStorage.setItem(DEVICE_KEY, device.deviceId);
        renderDevices();
      });
      return row;
    }));
  }

  /* Плейлисты */

  async function renderPlaylists() {
    const playlists = await music.playlists();

    if (playlists.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Пока нет своих плейлистов';
      playlistList.replaceChildren(empty);
      return;
    }

    playlistList.replaceChildren(...playlists.map((playlist) => {
      const row = document.createElement('div');
      row.className = 'playlist-row';

      const open = document.createElement('button');
      open.className = 'playlist-open';
      open.textContent = playlist.title;
      open.addEventListener('click', () => quadEntity.open({
        kind: 'playlist',
        provider: 'quad',
        id: playlist.id,
        title: playlist.title,
        subtitle: `${playlist.tracks.length} ${quadPlayer.plural(playlist.tracks.length, 'трек', 'трека', 'треков')}`,
        cover: playlist.tracks[0]?.coverMedium ?? null,
      }));

      const count = document.createElement('span');
      count.className = 'collection-link-count';
      count.textContent = playlist.tracks.length;

      // Удаление необратимо, поэтому первое нажатие только спрашивает.
      const remove = document.createElement('button');
      remove.className = 'row-action';
      remove.textContent = 'Удалить';
      remove.addEventListener('click', async () => {
        if (remove.textContent === 'Удалить') {
          remove.textContent = 'Точно?';
          return;
        }
        await music.removePlaylist(playlist.id);
        document.dispatchEvent(new CustomEvent('quad:library-changed'));
        renderPlaylists();
      });

      row.append(open, count, remove);
      return row;
    }));
  }

  playlistForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = playlistInput.value.trim();
    if (!title) return;
    await music.createPlaylist(title);
    playlistInput.value = '';
    document.dispatchEvent(new CustomEvent('quad:library-changed'));
    renderPlaylists();
  });

  navItem.addEventListener('click', () => {
    renderDevices();
    renderPlaylists();
  });
  document.addEventListener('quad:library-changed', renderPlaylists);

  // Подписка держит отдельный системный процесс, поэтому только когда список устройств открывали.
  navItem.addEventListener('click', () => {
    navigator.mediaDevices.addEventListener('devicechange', renderDevices);
  }, { once: true });

  const savedDevice = localStorage.getItem(DEVICE_KEY);
  if (savedDevice && savedDevice !== 'default') useDevice(savedDevice).catch(() => {});

  applyGains();
  renderCurve();
  renderPresets();
  renderToggle();
})();
