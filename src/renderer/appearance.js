// Внешний вид: всё живёт в CSS-переменных, поэтому меняется сразу и без перезапуска.
(() => {
  const KEY = 'quad.appearance';
  const DEFAULTS = {
    accent: '#ffffff',
    hue: null,
    fromCover: false,
    background: 'black',
    glow: 25,
    wall: 0,
    round: 100,
    density: 'normal',
    lyricsSize: 100,
    lyricsFont: 'unbounded',
    zoom: 100,
    calm: false,
    waveFx: 'full',
    // Каким фон был до выключения кнопкой на волне: туда же он и вернётся.
    waveFxLast: 'full',
  };

  const ACCENTS = [
    ['Белый', '#ffffff'],
    ['Лёд', '#9fd8ff'],
    ['Лаванда', '#c7b6ff'],
    ['Мята', '#9ff0c8'],
    ['Песок', '#ffd79a'],
    ['Коралл', '#ff9c8a'],
    ['Роза', '#ff9fc8'],
  ];
  const BACKGROUNDS = { black: ['Чёрный', '#000000'], graphite: ['Графит', '#0c0c0e'], midnight: ['Полночь', '#050913'], wine: ['Вино', '#0e0508'] };
  const DENSITIES = { tight: ['Плотно', 3, 34], normal: ['Обычно', 6, 40], roomy: ['Просторно', 10, 48] };
  const FONTS = { unbounded: ['Unbounded', '"Unbounded Variable", "Inter Variable", serif'], inter: ['Inter', '"Inter Variable", sans-serif'] };
  const ZOOMS = [90, 100, 110, 125];
  const WAVE_FX = { full: ['На всю'], soft: ['Спокойно'], off: ['Выключен'] };

  const root = document.documentElement;
  const section = document.getElementById('look');
  const fxToggle = document.getElementById('wave-fx-toggle');

  function stored() {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
      return {};
    }
  }

  let look = { ...DEFAULTS, ...stored() };
  let coverColor = null;

  /* Цвет */

  const hexToRgb = (hex) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));

  function hslToRgb(hue, saturation, lightness) {
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const channel = (shift) => {
      const k = (shift + hue / 30) % 12;
      return lightness - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [0, 8, 4].map((shift) => Math.round(channel(shift) * 255));
  }

  function rgbToHsl([red, green, blue]) {
    const [r, g, b] = [red / 255, green / 255, blue / 255];
    const high = Math.max(r, g, b);
    const low = Math.min(r, g, b);
    const lightness = (high + low) / 2;
    const delta = high - low;
    if (delta === 0) return [0, 0, lightness];

    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    let hue;
    if (high === r) hue = ((g - b) / delta + 6) % 6;
    else if (high === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    return [hue * 60, saturation, lightness];
  }

  function accentRgb() {
    if (look.fromCover) return coverColor ?? [255, 255, 255];
    if (look.hue !== null) return hslToRgb(look.hue, 0.85, 0.74);
    return hexToRgb(look.accent);
  }

  function applyAccent() {
    const rgb = accentRgb();
    const [red, green, blue] = rgb;
    const brightness = (red * 0.299 + green * 0.587 + blue * 0.114) / 255;
    root.style.setProperty('--accent', `rgb(${rgb.join(', ')})`);
    root.style.setProperty('--accent-rgb', rgb.join(', '));
    root.style.setProperty('--on-accent', brightness > 0.5 ? '#000' : '#fff');
    window.quadTint = rgb.join(',');
  }

  // Самый заметный цвет обложки, поднятый до яркости, на которой он читается на чёрном.
  async function readCoverColor(url) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = url;
    await image.decode();

    const canvas = new OffscreenCanvas(24, 24);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 24, 24);
    const { data } = context.getImageData(0, 0, 24, 24);

    const bins = Array.from({ length: 12 }, () => ({ weight: 0, hue: 0 }));
    for (let i = 0; i < data.length; i += 4) {
      const [hue, saturation, lightness] = rgbToHsl([data[i], data[i + 1], data[i + 2]]);
      const weight = saturation * (1 - Math.abs(lightness - 0.5) * 1.7);
      if (weight > 0.12) {
        const bin = bins[Math.floor(hue / 30) % 12];
        bin.weight += weight;
        bin.hue += hue * weight;
      }
    }

    const best = bins.reduce((a, b) => (b.weight > a.weight ? b : a));
    return best.weight < 6 ? null : hslToRgb(best.hue / best.weight, 0.8, 0.74);
  }

  async function followCover() {
    if (!look.fromCover) return;
    const url = quadPlayer.currentTrack()?.cover;
    if (!url) return;
    try {
      coverColor = await readCoverColor(url);
    } catch {
      coverColor = null;
    }
    applyAccent();
  }

  // Два соседних цвета обложки для фона волны. У серой обложки цвета нет.
  window.quadCoverTints = async (url) => {
    const color = await readCoverColor(url);
    if (!color) return null;
    const [hue, saturation, lightness] = rgbToHsl(color);
    return [color, hslToRgb((hue + 46) % 360, saturation, lightness)];
  };

  /* Применение */

  function apply() {
    const [, rowPad, rowCover] = DENSITIES[look.density];
    applyAccent();
    root.style.setProperty('--bg', BACKGROUNDS[look.background][1]);
    root.style.setProperty('--glow', String((look.glow / 100) * 0.4));
    root.style.setProperty('--shade', String(1 - (look.wall / 100) * 0.5));
    root.style.setProperty('--round', String(look.round / 100));
    root.style.setProperty('--row-pad', `${rowPad}px`);
    root.style.setProperty('--row-cover', `${rowCover}px`);
    root.style.setProperty('--lyrics-size', String(look.lyricsSize / 100));
    root.style.setProperty('--lyrics-font', FONTS[look.lyricsFont][1]);
    root.classList.toggle('is-calm', look.calm);
    root.dataset.waveFx = look.calm ? 'off' : look.waveFx;
    showFxToggle();
    windowControls.setZoom(look.zoom / 100);
  }

  // Кнопка «Фон» на волне выключает только живой фон, остальная анимация остаётся.
  // При «Меньше анимаций» фон и так выключен, и кнопка объясняет это вместо нажатия.
  function showFxToggle() {
    const isOn = look.waveFx !== 'off' && !look.calm;
    fxToggle.classList.toggle('is-on', isOn);
    fxToggle.setAttribute('aria-checked', String(isOn));
    fxToggle.setAttribute('aria-disabled', String(look.calm));
    if (look.calm) fxToggle.dataset.tip = 'Фон выключен вместе с «Меньше анимаций»';
    else fxToggle.dataset.tip = isOn ? 'Выключить живой фон' : 'Включить живой фон';
  }

  fxToggle.addEventListener('click', () => {
    if (look.calm) return;
    change({ waveFx: look.waveFx === 'off' ? look.waveFxLast : 'off' });
  });

  function change(values) {
    look = { ...look, ...values };
    if (look.waveFx !== 'off') look.waveFxLast = look.waveFx;
    localStorage.setItem(KEY, JSON.stringify(look));
    apply();
    render();
    document.dispatchEvent(new CustomEvent('quad:look'));
  }

  /* Панель настроек */

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function row(label, ...controls) {
    const box = element('div', 'look-row');
    const holder = element('div', 'look-control');
    holder.append(...controls);
    box.append(element('span', 'look-label', label), holder);
    return box;
  }

  function chips(options, current, pick) {
    return options.map(([value, label]) => {
      const button = element('button', 'recent-chip', label);
      button.classList.toggle('is-active', value === current);
      button.addEventListener('click', () => pick(value));
      return button;
    });
  }

  function slider(name, low, high, label) {
    const input = element('input', 'look-range');
    Object.assign(input, { type: 'range', min: low, max: high, value: look[name] });
    input.setAttribute('aria-label', label);

    const show = () => input.style.setProperty('--value', `${((input.value - low) / (high - low)) * 100}%`);
    input.addEventListener('input', () => {
      show();
      look[name] = Number(input.value);
      localStorage.setItem(KEY, JSON.stringify(look));
      apply();
      document.dispatchEvent(new CustomEvent('quad:look'));
    });
    show();
    return input;
  }

  function swatch(label, color, active, pick) {
    const button = element('button', 'look-swatch');
    button.style.setProperty('--swatch', color);
    button.classList.toggle('is-active', active);
    button.dataset.tip = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', pick);
    return button;
  }

  function accentRow() {
    const fixed = !look.fromCover && look.hue === null;
    const swatches = ACCENTS.map(([label, color]) => swatch(
      label,
      color,
      fixed && look.accent === color,
      () => change({ accent: color, hue: null, fromCover: false }),
    ));

    const cover = swatch('Из обложки трека', 'conic-gradient(#ff9c8a, #ffd79a, #9ff0c8, #9fd8ff, #c7b6ff, #ff9c8a)', look.fromCover, () => {
      change({ fromCover: !look.fromCover, hue: null });
      followCover();
    });
    cover.classList.add('is-cover');

    const hue = element('input', 'look-hue');
    Object.assign(hue, { type: 'range', min: 0, max: 360, value: look.hue ?? 200 });
    hue.setAttribute('aria-label', 'Свой цвет');
    hue.classList.toggle('is-active', look.hue !== null);
    hue.addEventListener('input', () => {
      look = { ...look, hue: Number(hue.value), fromCover: false };
      localStorage.setItem(KEY, JSON.stringify(look));
      applyAccent();
      hue.classList.add('is-active');
      section.querySelectorAll('.look-swatch').forEach((item) => item.classList.remove('is-active'));
    });

    return row('Цвет акцента', ...swatches, cover, hue);
  }

  function resetButton() {
    const button = element('button', 'row-action', 'Сбросить всё');
    button.addEventListener('click', () => {
      localStorage.removeItem(KEY);
      coverColor = null;
      look = { ...DEFAULTS };
      apply();
      render();
      quadLayout.reset();
      document.dispatchEvent(new CustomEvent('quad:layout-reset'));
    });
    return button;
  }

  function render() {
    const head = element('div', 'setting-head');
    head.append(element('h2', 'setting-title', 'Внешний вид'), resetButton());

    const toggle = element('button', 'toggle');
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', 'Меньше анимаций');
    toggle.setAttribute('aria-checked', String(look.calm));
    toggle.classList.toggle('is-on', look.calm);
    toggle.addEventListener('click', () => change({ calm: !look.calm }));

    const options = (table) => Object.entries(table).map(([value, [label]]) => [value, label]);

    section.replaceChildren(
      head,
      accentRow(),
      row('Фон', ...chips(options(BACKGROUNDS), look.background, (background) => change({ background }))),
      row('Свечение обложки', slider('glow', 0, 100, 'Свечение обложки')),
      row('Яркость стены на главной', slider('wall', 0, 100, 'Яркость стены на главной')),
      row('Живой фон', ...chips(options(WAVE_FX), look.waveFx, (waveFx) => change({ waveFx }))),
      row('Закругления', slider('round', 0, 200, 'Закругления')),
      row('Плотность списков', ...chips(options(DENSITIES), look.density, (density) => change({ density }))),
      row('Размер текста песни', slider('lyricsSize', 70, 140, 'Размер текста песни')),
      row('Шрифт текста песни', ...chips(options(FONTS), look.lyricsFont, (lyricsFont) => change({ lyricsFont }))),
      row('Масштаб', ...chips(ZOOMS.map((zoom) => [zoom, `${zoom}%`]), look.zoom, (zoom) => change({ zoom }))),
      row('Меньше анимаций', toggle),
    );
  }

  apply();
  render();
  document.addEventListener('quad:track', followCover);
})();
