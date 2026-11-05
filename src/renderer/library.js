(() => {
  const FOLDED_KEY = 'quad.libraryFolded';
  const GROUPS = [
    ['playlists', 'Плейлисты', 'Свои плейлисты появятся здесь'],
    ['albums', 'Альбомы', 'Добавленные альбомы появятся здесь'],
    ['collections', 'Сборники', 'Добавленные сборники появятся здесь'],
  ];

  const view = document.getElementById('view-library');
  const message = document.getElementById('library-message');
  const page = document.getElementById('library-page');
  const navItem = document.querySelector('[data-view="library"]');
  const trackList = new TrackList(page);
  const sources = new SourceSwitch(document.getElementById('library-sources'), {
    storageKey: 'quad.librarySource',
    onChange: showSource,
  });

  let request = 0;
  let stale = true;
  let activeId = null;
  let shown = [];
  const folded = new Set(JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]'));

  // У разных сервисов бывают одинаковые номера, например «liked».
  const linkKey = (collection) => `${collection.provider}:${collection.id}`;

  function showMessage(text) {
    message.textContent = text;
    message.hidden = false;
    page.hidden = true;
    view.classList.add('view-center');
  }

  function open(collection, link) {
    trackList.extras.querySelector('.is-active')?.classList.remove('is-active');
    link.classList.add('is-active');
    activeId = linkKey(collection);
    const { count = 0 } = collection;
    trackList.open({
      ...collection,
      subtitle: `${count} ${quadPlayer.plural(count, 'трек', 'трека', 'треков')}`,
      emptyText: collection.provider === 'downloads' ? 'Скачанных треков пока нет' : 'Здесь пока пусто',
    });
  }

  function createLink(collection) {
    const link = document.createElement('button');
    link.className = 'collection-link';

    const thumb = document.createElement('span');
    thumb.className = 'collection-thumb';
    if (collection.cover) {
      const image = document.createElement('img');
      image.src = collection.cover;
      image.alt = '';
      thumb.append(image);
    } else {
      const icon = collection.provider === 'downloads' ? 'download-icon' : 'heart-icon';
      thumb.append(document.getElementById(icon).content.cloneNode(true));
    }

    const title = document.createElement('span');
    title.className = 'collection-link-title';
    title.textContent = collection.title;

    const count = document.createElement('span');
    count.className = 'collection-link-count';
    count.textContent = collection.count;

    link.append(thumb, title, count);
    link.classList.toggle('is-active', linkKey(collection) === activeId);
    link.addEventListener('click', () => open(collection, link));
    return link;
  }

  function toggleGroup(group) {
    if (folded.has(group)) folded.delete(group);
    else folded.add(group);
    localStorage.setItem(FOLDED_KEY, JSON.stringify([...folded]));
    renderLinks();
  }

  function createHeading(group, title, count) {
    const heading = document.createElement('button');
    heading.className = 'collection-heading';
    heading.classList.toggle('is-folded', folded.has(group));
    heading.setAttribute('aria-expanded', String(!folded.has(group)));

    const name = document.createElement('span');
    name.textContent = title;
    const total = document.createElement('span');
    total.className = 'collection-link-count';
    total.textContent = count;

    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('viewBox', '0 0 14 14');
    arrow.innerHTML = '<path d="M3 5l4 4 4-4"/>';

    heading.append(name, total, arrow);
    heading.addEventListener('click', () => toggleGroup(group));
    return heading;
  }

  function createNote(text) {
    const note = document.createElement('p');
    note.className = 'collection-note';
    note.textContent = text;
    return note;
  }

  // Сверху то, что есть всегда, ниже разделы.
  function renderLinks() {
    const visible = shown.filter((collection) => sources.includes(collection.provider));
    trackList.extras.replaceChildren(
      ...visible.filter((collection) => !collection.group).map(createLink),
      ...GROUPS.flatMap(([group, title, empty]) => {
        const items = visible.filter((collection) => collection.group === group);
        const heading = createHeading(group, title, items.length);
        if (folded.has(group)) return [heading];
        return [heading, ...(items.length > 0 ? items.map(createLink) : [createNote(empty)])];
      }),
    );
  }

  const firstLink = () => trackList.extras.querySelector('.collection-link');

  // Открытый список остаётся, если он есть и у выбранного сервиса, например Скачанные.
  function showSource() {
    if (page.hidden) return;
    renderLinks();
    if (!trackList.extras.querySelector('.collection-link.is-active')) firstLink()?.click();
  }

  async function load() {
    stale = false;
    request += 1;
    const current = request;

    if (!quadPlayer.hasAccount()) {
      showMessage('Подключи аккаунт, чтобы увидеть медиатеку');
      return;
    }

    showMessage('Загрузка');
    try {
      const collections = await music.library();
      if (current !== request) return;

      message.hidden = true;
      page.hidden = false;
      view.classList.remove('view-center');
      shown = collections;
      activeId = null;
      renderLinks();
      firstLink()?.click();
    } catch {
      if (current === request) {
        stale = true;
        showMessage('Не удалось загрузить медиатеку');
      }
    }
  }

  navItem.addEventListener('click', () => {
    if (stale) load();
  });

  function reloadOnAccounts() {
    stale = true;
    if (view.classList.contains('is-active')) load();
  }

  // После лайка или правки плейлиста меняются только счётчики: открытый список и прокрутка остаются.
  async function refreshLinks() {
    if (!view.classList.contains('is-active') || page.hidden) {
      stale = true;
      return;
    }

    shown = await music.library();
    renderLinks();
  }

  document.addEventListener('quad:accounts', reloadOnAccounts);
  document.addEventListener('quad:library-changed', refreshLinks);
})();
