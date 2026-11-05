// Экран артиста или альбома. Открывается из поиска, плеера и страницы трека.
(() => {
  const HEADINGS = { artist: 'Исполнитель', album: 'Альбом', playlist: 'Плейлист' };

  const view = document.getElementById('view-entity');
  const trackList = new TrackList(document.getElementById('entity-page'));

  let history = [];
  let returnTo = 'home';
  let request = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function shelf(title, items) {
    const section = element('section', 'shelf-section');
    const row = element('div', 'shelf');
    row.append(...items.map((item, index) => {
      const card = element('button', `shelf-item is-${item.kind}`);
      card.style.setProperty('--row', Math.min(index, 8));

      const cover = element('span', 'shelf-cover');
      const image = element('img');
      image.alt = '';
      if (item.cover) image.src = item.cover;
      cover.append(image);

      card.append(
        cover,
        element('span', 'shelf-title', item.title),
        element('span', 'shelf-subtitle', item.subtitle),
      );
      card.addEventListener('click', () => open(item));
      return card;
    }));

    // Колёсико мыши листает ряд вбок.
    row.addEventListener('wheel', (event) => {
      if (row.scrollWidth <= row.clientWidth) return;
      event.preventDefault();
      row.scrollLeft += event.deltaY;
    }, { passive: false });

    section.append(element('h2', 'section-title', title), row);
    return section;
  }

  async function show(entity) {
    request += 1;
    const current = request;
    showView('entity', HEADINGS[entity.kind]);
    trackList.top.replaceChildren();

    let details = entity;
    if (entity.kind === 'artist') {
      try {
        details = await music.artist(entity.provider, entity.id);
      } catch {
        // Без подробностей экран всё равно работает: треки загрузятся и так.
      }
      if (current !== request) return;
    }

    trackList.open(details);

    const shelves = [];
    if (details.albums?.length > 0) shelves.push(shelf('Альбомы', details.albums));
    if (details.similar?.length > 0) shelves.push(shelf('Похожие', details.similar));
    trackList.top.replaceChildren(...shelves);
  }

  function open(entity) {
    document.dispatchEvent(new CustomEvent('quad:close-page'));
    if (!view.classList.contains('is-active')) {
      history = [];
      returnTo = document.querySelector('.nav-item.is-active').dataset.view;
    }
    history.push(entity);
    show(entity);
  }

  function back() {
    history.pop();
    const previous = history.at(-1);
    if (previous) show(previous);
    else showView(returnTo);
  }

  const backButton = element('button', 'hero-back', 'Назад');
  backButton.addEventListener('click', back);
  trackList.extras.append(backButton);

  window.quadEntity = { open, shelf };
})();
