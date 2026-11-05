(() => {
  const RECENT_KEY = 'quad.recentSearches';
  const RECENT_LIMIT = 8;
  const SEARCH_DELAY = 300;
  const TOP_TRACKS = 8;

  const input = document.getElementById('search');
  const view = document.getElementById('view-search');
  const idle = document.getElementById('search-idle');
  const idleTitle = document.getElementById('search-idle-title');
  const recentBox = document.getElementById('search-recent');
  const results = document.getElementById('search-results');
  const scroller = document.querySelector('.scroll');

  const sources = new SourceSwitch(document.getElementById('search-sources'), {
    storageKey: 'quad.searchSource',
    onChange: () => {
      const text = input.value.trim();
      input.focus();
      if (text) runSearch(text);
    },
  });

  let timer = 0;
  let request = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function coverImage(url) {
    const image = element('img');
    image.alt = '';
    if (url) image.src = url;
    return image;
  }

  function show(state) {
    idle.hidden = state !== 'idle';
    results.hidden = state !== 'results';
    view.classList.toggle('view-center', state === 'idle');
    scroller.scrollTop = 0;
  }

  /* Недавние */

  function recentSearches() {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  }

  function remember(text) {
    if (!text) return;
    const recent = [text, ...recentSearches().filter((item) => item !== text)].slice(0, RECENT_LIMIT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  }

  function showIdle(title) {
    idleTitle.textContent = title;
    recentBox.replaceChildren(...(quadPlayer.hasAccount() ? recentSearches() : []).map((text) => {
      const chip = element('button', 'recent-chip', text);
      chip.addEventListener('click', () => {
        input.value = text;
        input.focus();
        runSearch(text);
      });
      return chip;
    }));
    show('idle');
  }

  function showDefault() {
    showIdle(quadPlayer.hasAccount()
      ? 'Найди трек, альбом или исполнителя'
      : 'Подключи аккаунт, чтобы искать музыку');
  }

  /* Результаты */

  function bestCard(best, tracks) {
    const { kind, item } = best;
    const card = element('button', `best-card is-${kind}`);

    const cover = element('span', 'best-cover');
    cover.append(coverImage(item.coverMedium ?? item.cover));

    const play = element('span', 'best-play');
    play.append(document.getElementById('row-play-icon').content.cloneNode(true));

    const kinds = { track: 'Трек', artist: 'Исполнитель', album: 'Альбом' };
    card.append(
      cover,
      element('span', 'best-kind', `Лучший результат · ${kinds[kind]}`),
      element('span', 'best-title', item.title),
      element('span', 'best-subtitle', kind === 'track' ? item.artists : item.subtitle),
      play,
    );

    card.addEventListener('click', () => {
      if (kind !== 'track') {
        quadEntity.open(item);
        return;
      }
      const index = tracks.findIndex((track) => track.id === item.id);
      if (index >= 0) quadPlayer.play(tracks, index);
      else quadPlayer.play([item], 0);
    });
    return card;
  }

  function trackRows(tracks, from, to) {
    const list = element('ul', 'tracks');
    list.append(...tracks.slice(from, to).map((track, offset) => (
      quadPlayer.createRow(track, from + offset, tracks)
    )));
    return list;
  }

  function render({ best, tracks, artists, albums }) {
    const top = best ?? (tracks[0] ? { kind: 'track', item: tracks[0] } : null);
    const sections = [];

    if (top) {
      const grid = element('div', 'search-grid');
      const column = element('div', 'search-top-tracks');
      column.append(element('h2', 'section-title', 'Треки'), trackRows(tracks, 0, TOP_TRACKS));
      grid.append(bestCard(top, tracks), column);
      sections.push(grid);
    }

    if (artists.length > 0) sections.push(quadEntity.shelf('Исполнители', artists));
    if (albums.length > 0) sections.push(quadEntity.shelf('Альбомы', albums));

    if (tracks.length > TOP_TRACKS) {
      const more = element('section', 'shelf-section');
      more.append(element('h2', 'section-title', 'Ещё треки'), trackRows(tracks, TOP_TRACKS, tracks.length));
      sections.push(more);
    }

    results.replaceChildren(...sections);
    quadPlayer.markCurrentRow();
    show('results');
  }

  async function runSearch(text) {
    clearTimeout(timer);
    request += 1;
    const current = request;
    results.classList.add('is-updating');

    try {
      const found = await music.search(text, sources.value);
      if (current !== request) return;
      const isEmpty = !found.best && found.tracks.length + found.artists.length + found.albums.length === 0;
      if (isEmpty) showIdle('Ничего не нашлось');
      else render(found);
    } catch {
      if (current === request) showIdle('Не удалось выполнить поиск');
    } finally {
      if (current === request) results.classList.remove('is-updating');
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    request += 1;
    const text = input.value.trim();

    if (!text) showDefault();
    else if (!quadPlayer.hasAccount()) showIdle('Сначала подключи аккаунт');
    else timer = setTimeout(() => runSearch(text), SEARCH_DELAY);
  });

  results.addEventListener('click', () => remember(input.value.trim()));

  document.addEventListener('quad:accounts', () => {
    if (!input.value.trim()) showDefault();
  });
})();
