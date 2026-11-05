(() => {
  const view = document.getElementById('view-library');
  const message = document.getElementById('library-message');
  const page = document.getElementById('library-page');
  const navItem = document.querySelector('[data-view="library"]');
  const trackList = new TrackList(page);

  let request = 0;
  let stale = true;
  let activeId = null;

  function showMessage(text) {
    message.textContent = text;
    message.hidden = false;
    page.hidden = true;
    view.classList.add('view-center');
  }

  function open(collection, link) {
    trackList.extras.querySelector('.is-active')?.classList.remove('is-active');
    link.classList.add('is-active');
    activeId = collection.id;
    const { count } = collection;
    trackList.open({
      ...collection,
      subtitle: `${count} ${quadPlayer.plural(count, 'трек', 'трека', 'треков')}`,
      emptyText: collection.provider === 'downloads' ? 'Скачанных треков пока нет' : undefined,
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
    link.addEventListener('click', () => open(collection, link));
    return link;
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
      trackList.extras.replaceChildren(...collections.map(createLink));
      trackList.extras.firstElementChild?.click();
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

    const collections = await music.library();
    trackList.extras.replaceChildren(...collections.map((collection) => {
      const link = createLink(collection);
      link.classList.toggle('is-active', collection.id === activeId);
      return link;
    }));
  }

  document.addEventListener('quad:accounts', reloadOnAccounts);
  document.addEventListener('quad:library-changed', refreshLinks);
})();
