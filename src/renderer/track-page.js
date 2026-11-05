(() => {
  const FLIGHT_MS = 640;
  const FLIGHT_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  const MANUAL_SCROLL_PAUSE = 4000;
  const MIN_LINE_SECONDS = 0.5;
  const MAX_LINE_SECONDS = 10;

  // Ширина светового окна, бегущего по текущей строке. Должна совпадать с --crest-width в CSS.
  const CREST_WIDTH = 100;
  const CREST_SMOOTHING = 0.85;

  // Раскладка страницы. Должно совпадать с отступами и колонками в CSS.
  const SPLIT_KEY = 'quad.pageSplit';
  const INFO_PADDING = 14;
  const DIVIDER_SPACE = 53;
  const COVER_GAP = 24;
  const MIN_COVER = 200;
  const NATURAL_SHARE = 0.52;

  // Текст песни при сжатии мельчает до этой доли, а уже потом исчезает.
  const MIN_LYRICS_FIT = 0.5;
  const MAX_LYRICS_FIT = 1.2;
  const LYRICS_GONE_BELOW = 230;

  // На сколько пикселей обложка может заехать на подписи, пока они не растворятся совсем.
  const TEXT_FADE_RANGE = 150;
  const RESET_MS = 420;

  // Постоянный слой на видеокарте нужен только строкам рядом с текущей.
  const NEAR_LINES = 10;

  const page = document.getElementById('track-page');
  const ambient = document.getElementById('page-ambient');
  const cover = document.getElementById('page-cover');
  const title = document.getElementById('page-title');
  const artists = document.getElementById('page-artists');
  const details = document.getElementById('page-details');
  const lyricsBox = document.getElementById('page-lyrics');
  const lyricsHolder = document.getElementById('page-lyrics-box');
  const info = document.getElementById('page-info');
  const coverFrame = document.getElementById('page-cover-frame');
  const pageText = document.getElementById('page-text');
  const divider = document.getElementById('page-divider');
  const miniCover = document.getElementById('now-cover');
  const { audio } = quadPlayer;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const calm = () => reducedMotion || document.documentElement.classList.contains('is-calm');

  let isOpen = false;
  let shownKey = null;
  let lyricsRequest = 0;
  let lyricLines = [];
  let activeLine = -1;
  let activeParts = [];
  let lineStart = 0;
  let lineSeconds = 1;
  let crestLoop = false;
  let lastCrestFrame = 0;
  let smoothProgress = null;
  let manualOffset = 0;
  let manualTimer = 0;
  let writers = [];
  let lyricsSource = null;
  let split = Number(localStorage.getItem(SPLIT_KEY)) || null;
  let naturalWidth = 0;
  let layoutFrame = 0;

  const trackKey = (track) => `${track.provider}:${track.id}`;

  /* Детали */

  function renderDetails(track) {
    const quality = quadPlayer.currentStream()?.quality;
    const rows = [
      ['Альбом', track.album],
      ['Год', track.year],
      ['Жанр', track.genre],
      ['Лейбл', track.label],
      ['Авторы', writers.join(', ')],
      ['Текст', lyricsSource],
      ['Качество', quality],
      ['Сервис', track.providerName],
    ];

    details.replaceChildren(...rows.filter(([, value]) => value).map(([name, value]) => {
      const term = document.createElement('dt');
      term.textContent = name;
      const description = document.createElement('dd');
      description.dataset.tip = value;
      description.append(name === 'Альбом' ? quadPlayer.albumLink(track) : value);

      const item = document.createElement('div');
      item.className = 'page-detail';
      item.append(term, description);
      return item;
    }));
    if (isOpen) layoutPage();
  }

  /* Раскладка: линия делит страницу между обложкой и текстом */

  function usableWidth() {
    const style = getComputedStyle(page);
    return page.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - DIVIDER_SPACE;
  }

  // Обложка заполняет колонку, но не выше самой страницы. Подписи всегда шириной с обложку.
  function placeCover(width) {
    page.style.setProperty('--info-w', `${width}px`);
    const height = info.clientHeight - INFO_PADDING * 2;
    const size = Math.max(MIN_COVER, Math.min(width - INFO_PADDING * 2, height));
    page.style.setProperty('--cover', `${size}px`);
    return { size, room: height - pageText.offsetHeight - COVER_GAP };
  }

  // Ширина, при которой обложка и подписи ровно помещаются по высоте.
  function findNaturalWidth(total) {
    let width = total * 0.4;
    for (let pass = 0; pass < 3; pass += 1) {
      const { room } = placeCover(width);
      width = Math.min(Math.max(MIN_COVER, room) + INFO_PADDING * 2, total * NATURAL_SHARE);
    }
    return width;
  }

  function layoutPage({ keepNatural = false } = {}) {
    const total = usableWidth();
    if (!keepNatural || naturalWidth === 0) naturalWidth = findNaturalWidth(total);

    const lowest = MIN_COVER + INFO_PADDING * 2;
    const width = split === null ? naturalWidth : Math.max(lowest, Math.min(total, split * total));
    const { size, room } = placeCover(width);
    pageText.style.setProperty('--text-fade', Math.max(0, Math.min(1, 1 - (size - room) / TEXT_FADE_RANGE)).toFixed(3));

    const lyricsWidth = total - width;
    const fit = lyricsWidth / (total - naturalWidth);
    lyricsBox.style.setProperty('--fit', Math.max(MIN_LYRICS_FIT, Math.min(MAX_LYRICS_FIT, fit)).toFixed(3));
    lyricsHolder.classList.toggle('is-gone', lyricsWidth < LYRICS_GONE_BELOW);

    if (isOpen) {
      restartLine();
      placeLyrics();
    }
  }

  function requestLayout() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => layoutPage({ keepNatural: true }));
  }

  function saveSplit() {
    if (split === null) localStorage.removeItem(SPLIT_KEY);
    else localStorage.setItem(SPLIT_KEY, String(split));
  }

  function resetSplit() {
    const total = usableWidth();
    const from = (split ?? naturalWidth / total);
    const to = naturalWidth / total;
    const started = performance.now();

    const step = (now) => {
      const t = Math.min(1, (now - started) / (calm() ? 1 : RESET_MS));
      split = from + (to - from) * (1 - (1 - t) ** 3);
      layoutPage({ keepNatural: true });
      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }
      split = null;
      saveSplit();
    };
    requestAnimationFrame(step);
  }

  function dragDivider(event) {
    const box = info.getBoundingClientRect();
    split = (event.clientX - box.left) / usableWidth();
    requestLayout();
  }

  function showCover(track) {
    if (track.cover) cover.src = track.cover;
    else cover.removeAttribute('src');
    quadPlayer.paintAmbient(ambient, track.cover);
    if (!track.coverLarge) return;

    // Маленькая обложка уже в кэше и показывается сразу, большая подменяет её, когда загрузится.
    const large = new Image();
    large.src = track.coverLarge;
    large.decode().then(() => {
      if (shownKey === trackKey(track)) cover.src = large.src;
    }).catch(() => {});
  }

  /* Текст */

  function showLyricsMessage(text) {
    lyricLines = [];
    activeParts = [];
    const note = document.createElement('p');
    note.className = 'lyrics-note';
    note.textContent = text;
    lyricsBox.replaceChildren(note);
  }

  function renderLyrics(lyrics) {
    lyricsBox.classList.toggle('is-synced', lyrics.synced);
    lyricLines = lyrics.lines;
    activeLine = -1;
    activeParts = [];
    resetManualScroll();

    lyricsBox.replaceChildren(...lyrics.lines.map((line) => {
      const row = document.createElement(lyrics.synced ? 'button' : 'p');
      row.className = 'lyric';
      row.textContent = line.text;
      if (lyrics.synced) {
        row.addEventListener('click', () => {
          resetManualScroll();
          audio.currentTime = line.time;
        });
      }
      return row;
    }));
    lyricsBox.scrollTop = 0;
    placeLyrics();
    syncLyrics();
  }

  async function loadLyrics(track) {
    lyricsRequest += 1;
    const request = lyricsRequest;
    writers = [];
    lyricsSource = null;
    lyricsBox.classList.remove('is-synced');

    showLyricsMessage('Загрузка');
    try {
      const lyrics = await music.lyrics(track);
      if (request !== lyricsRequest) return;
      if (!lyrics) {
        showLyricsMessage('Текста нет');
        return;
      }
      writers = lyrics.writers;
      lyricsSource = lyrics.source ?? null;
      renderLyrics(lyrics);
      renderDetails(track);
    } catch {
      if (request === lyricsRequest) showLyricsMessage('Не удалось загрузить текст');
    }
  }

  // Строки едут трансформацией, а не прокруткой: так у каждой своя задержка и текст идёт волной.
  function placeLyrics() {
    const row = lyricsBox.children[Math.max(activeLine, 0)];
    if (!row || !lyricsBox.classList.contains('is-synced')) return;
    const center = lyricsBox.clientHeight / 2 - (row.offsetTop + row.offsetHeight / 2);
    lyricsBox.style.setProperty('--y', `${center + manualOffset}px`);
  }

  function resetManualScroll() {
    clearTimeout(manualTimer);
    manualOffset = 0;
    lyricsBox.classList.remove('is-manual');
  }

  function scrollManually(event) {
    if (!lyricsBox.classList.contains('is-synced')) return;
    manualOffset -= event.deltaY;
    lyricsBox.classList.add('is-manual');
    placeLyrics();

    clearTimeout(manualTimer);
    manualTimer = setTimeout(() => {
      resetManualScroll();
      placeLyrics();
    }, MANUAL_SCROLL_PAUSE);
  }

  // Где браузер перенёс строку: слова с другой высотой начинают новую видимую часть.
  function visualParts(row, text) {
    const node = row.firstChild;
    const range = document.createRange();
    const parts = [];
    let top = null;

    for (const word of text.matchAll(/\S+\s*/g)) {
      range.setStart(node, word.index);
      range.setEnd(node, word.index + 1);
      const wordTop = range.getBoundingClientRect().top;
      if (top === null || Math.abs(wordTop - top) > 4) {
        parts.push('');
        top = wordTop;
      }
      parts[parts.length - 1] += word[0];
    }
    return parts.map((part) => part.trimEnd());
  }

  // Текст остаётся цельным: буквы не двигаются и кернинг не теряется. Волна — это
  // светящаяся копия поверх, видимая только в окне, бегущем по каждой части строки.
  function layerPart(text) {
    const part = document.createElement('span');
    part.className = 'lyric-part';

    const base = document.createElement('span');
    base.className = 'lyric-base';
    base.textContent = text;

    const lens = document.createElement('span');
    lens.className = 'lyric-lens';
    lens.setAttribute('aria-hidden', 'true');
    lens.textContent = text;

    part.append(base, lens);
    part.style.setProperty('--crest', `${-CREST_WIDTH}px`);
    return part;
  }

  function clearActiveLine() {
    const row = lyricsBox.children[activeLine];
    if (row && lyricLines[activeLine]) {
      row.classList.remove('is-active');
      row.textContent = lyricLines[activeLine].text;
    }
    activeParts = [];
  }

  function startLine(line, row) {
    const next = lyricLines[line + 1]?.time ?? audio.duration;
    lineStart = lyricLines[line].time;
    lineSeconds = Math.min(MAX_LINE_SECONDS, Math.max(MIN_LINE_SECONDS, next - lineStart));

    const parts = visualParts(row, lyricLines[line].text).map(layerPart);
    row.replaceChildren(...parts);

    let offset = 0;
    activeParts = parts.map((element) => {
      const part = { element, offset, width: element.offsetWidth };
      offset += part.width;
      return part;
    });
    smoothProgress = null;
  }

  // Позиция считается от времени трека, поэтому пауза и перемотка работают сами.
  // Время обновляется ступеньками, поэтому окно догоняет его плавно.
  function drawCrest(ms) {
    const target = Math.min(1, Math.max(0, (audio.currentTime - lineStart) / lineSeconds));
    smoothProgress = smoothProgress === null
      ? target
      : smoothProgress + (target - smoothProgress) * (1 - CREST_SMOOTHING ** (ms / 16.7));

    // Части стоят в одну воображаемую линию: окно уходит с конца одной и входит в начало следующей.
    const last = activeParts.at(-1);
    const travel = last.offset + last.width + CREST_WIDTH * 2;
    const position = smoothProgress * travel - CREST_WIDTH;

    activeParts.forEach(({ element, offset, width }) => {
      const crest = Math.min(width + CREST_WIDTH, Math.max(-CREST_WIDTH, position - offset));
      element.style.setProperty('--crest', `${crest.toFixed(1)}px`);
    });
  }

  function crestFrame(now) {
    if (!isOpen) {
      crestLoop = false;
      return;
    }
    const ms = Math.min(now - lastCrestFrame, 50);
    lastCrestFrame = now;
    if (activeParts.length > 0) drawCrest(ms);
    requestAnimationFrame(crestFrame);
  }

  function startCrestLoop() {
    if (crestLoop) return;
    crestLoop = true;
    lastCrestFrame = performance.now();
    requestAnimationFrame(crestFrame);
  }

  function syncLyrics() {
    if (!isOpen || !lyricsBox.classList.contains('is-synced')) return;

    let line = -1;
    for (let i = 0; i < lyricLines.length && lyricLines[i].time <= audio.currentTime; i += 1) line = i;
    if (line === activeLine) return;

    clearActiveLine();
    activeLine = line;

    [...lyricsBox.children].forEach((row, index) => {
      const distance = Math.abs(index - Math.max(line, 0));
      row.style.setProperty('--d', distance);
      row.classList.toggle('is-near', distance <= NEAR_LINES);
    });

    const row = lyricsBox.children[line];
    if (row) {
      row.classList.add('is-active');
      startLine(line, row);
    }
    if (manualOffset === 0) placeLyrics();
  }

  function restartLine() {
    clearActiveLine();
    activeLine = -2;
    syncLyrics();
  }

  /* Страница */

  function render() {
    const track = quadPlayer.currentTrack();
    if (!track) return;

    const key = trackKey(track);
    if (key !== shownKey) {
      shownKey = key;
      title.textContent = track.title;
      quadPlayer.renderArtistLinks(artists, track);
      showCover(track);
      loadLyrics(track);
    }
    renderDetails(track);
  }

  function flight() {
    const from = miniCover.getBoundingClientRect();
    const to = cover.getBoundingClientRect();
    return [
      {
        transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width})`,
        borderRadius: '40px',
      },
      { transform: 'none', borderRadius: '10px' },
    ];
  }

  function open() {
    if (isOpen || !quadPlayer.currentTrack()) return;
    isOpen = true;
    page.hidden = false;
    render();
    layoutPage();
    startCrestLoop();

    document.body.classList.add('page-open');
    miniCover.classList.add('is-away');
    page.classList.remove('is-closing');
    page.classList.add('is-open');
    info.classList.add('is-flying');

    // Пока обложка летит, маленькой в плеере нет. Когда прилетела, она возвращается на место.
    const landing = cover.animate(flight(), {
      duration: calm() ? 0 : FLIGHT_MS,
      easing: FLIGHT_EASING,
    });
    landing.finished.then(() => {
      info.classList.remove('is-flying');
      if (isOpen) miniCover.classList.remove('is-away');
    });
  }

  async function close() {
    if (!isOpen) return;
    isOpen = false;
    miniCover.classList.add('is-away');
    document.body.classList.remove('page-open');
    page.classList.remove('is-open');
    page.classList.add('is-closing');
    info.classList.add('is-flying');

    const landing = cover.animate(flight().reverse(), {
      duration: calm() ? 0 : FLIGHT_MS * 0.8,
      easing: FLIGHT_EASING,
      fill: 'forwards',
    });
    await landing.finished;

    miniCover.classList.remove('is-away');
    info.classList.remove('is-flying');
    if (!isOpen) page.hidden = true;
    landing.cancel();
  }

  miniCover.addEventListener('click', () => {
    if (isOpen) close();
    else open();
  });
  document.getElementById('page-close').addEventListener('click', close);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  document.addEventListener('quad:close-page', close);

  document.addEventListener('quad:track', () => {
    if (isOpen) render();
  });

  audio.addEventListener('timeupdate', syncLyrics);
  audio.addEventListener('seeked', restartLine);

  lyricsBox.addEventListener('wheel', scrollManually, { passive: true });
  window.addEventListener('resize', () => {
    if (isOpen) layoutPage();
  });

  divider.addEventListener('pointerdown', (event) => {
    divider.setPointerCapture(event.pointerId);
    divider.classList.add('is-dragging');
    document.body.classList.add('is-resizing');
    dragDivider(event);
  });
  divider.addEventListener('pointermove', (event) => {
    if (divider.hasPointerCapture(event.pointerId)) dragDivider(event);
  });
  divider.addEventListener('pointerup', () => {
    divider.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing');
    saveSplit();
  });
  divider.addEventListener('dblclick', resetSplit);

  document.addEventListener('quad:look', () => {
    if (isOpen) layoutPage();
  });
  document.addEventListener('quad:layout-reset', () => {
    split = null;
    saveSplit();
    if (isOpen) layoutPage();
  });
})();
