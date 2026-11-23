// Страница коллекции: панель с обложкой и кнопками слева, треки справа.
// Используется в Медиатеке и для исполнителей и альбомов из Поиска.
class TrackList {
  static LOAD_MORE_MARGIN = 500;
  static MOSAIC_SIZE = 4;

  // Строки вокруг видимой области: при быстрой прокрутке пустота не успевает показаться.
  static OVERSCAN = 14;

  // Столько длится появление строк при открытии списка. Дальше строки появляются без анимации.
  static FRESH_MS = 900;

  // Перетаскивание строк: с какого сдвига мыши оно начинается и как список листается у краёв.
  static DRAG_START_PX = 6;
  static SCROLL_EDGE = 70;
  static SCROLL_SPEED = 18;
  static ORDER_PREFIX = 'quad.order.';

  constructor(root, { reorderable = false } = {}) {
    root.append(document.getElementById('collection-template').content.cloneNode(true));

    this.root = root;
    this.scroller = document.querySelector('.scroll');
    this.frame = root.querySelector('.hero-cover-frame');
    this.glow = root.querySelector('.hero-glow');
    this.cover = root.querySelector('.hero-cover');
    this.title = root.querySelector('.hero-title');
    this.subtitle = root.querySelector('.hero-subtitle');
    this.playButton = root.querySelector('.hero-play');
    this.shuffleButton = root.querySelector('.hero-shuffle');
    this.extras = root.querySelector('.hero-extras');
    this.top = root.querySelector('.collection-top');
    this.list = root.querySelector('.tracks');
    this.list.classList.add('is-windowed');

    // Ссылка на этот массив становится очередью, поэтому новые страницы дописываются в него же.
    this.tracks = [];
    this.collection = null;
    this.nextOffset = null;
    this.loading = false;
    this.request = 0;

    // На странице живут только видимые строки: в медиатеке их тысячи, и каждая держит память.
    this.rendered = new Map();
    this.rowHeight = 0;
    this.windowFrame = 0;
    this.freshTimer = 0;
    this.onRemove = undefined;

    // Свой порядок треков: ключ трека и его место. Пока порядка нет, треки идут как у сервиса.
    this.reorderable = reorderable;
    this.order = null;
    this.ranks = new Map();
    this.anchor = -1;
    this.lastIncoming = null;
    this.drag = null;
    this.pointerY = 0;
    this.suppressClick = false;
    if (reorderable) this.enableDrag();

    this.playButton.addEventListener('click', () => quadPlayer.play(this.tracks, 0));
    this.shuffleButton.addEventListener('click', () => {
      quadPlayer.play(quadPlayer.shuffled(this.tracks), 0);
    });
    this.scroller.addEventListener('scroll', () => {
      if (root.offsetParent === null) return;
      this.requestWindow();
      const left = this.scroller.scrollHeight - this.scroller.scrollTop - this.scroller.clientHeight;
      if (left < TrackList.LOAD_MORE_MARGIN) this.loadMore();
    }, { passive: true });

    // Общая прокрутка сбрасывается при смене экрана, и событие может не прийти.
    document.addEventListener('quad:view', () => this.requestWindow());

    // Плотность и масштаб меняют высоту строки.
    document.addEventListener('quad:look', () => {
      this.clearRows();
      this.requestWindow();
    });
  }

  clearRows() {
    this.rendered.clear();
    this.rowHeight = 0;
    this.list.replaceChildren();
    this.list.style.removeProperty('padding-top');
    this.list.style.removeProperty('height');
  }

  requestWindow() {
    if (this.windowFrame !== 0) return;
    this.windowFrame = requestAnimationFrame(() => {
      this.windowFrame = 0;
      this.renderWindow();
    });
  }

  createItem(index) {
    const item = quadPlayer.createRow(this.tracks[index], index, this.tracks, { onRemove: this.onRemove });
    item.dataset.index = index;
    if (this.drag && this.tracks[index] === this.drag.track) item.classList.add('is-drag-source');
    this.rendered.set(index, item);
    return item;
  }

  // Все строки одной высоты, поэтому видимый кусок считается без замеров каждой.
  // Высоту списка держит пустое место сверху и заданная высота, ползунок прокрутки честный.
  renderWindow() {
    const { list, rendered, root, scroller, tracks } = this;
    if (root.offsetParent === null || tracks.length === 0) return;

    if (this.rowHeight === 0) {
      list.append(this.createItem(0));
      this.rowHeight = rendered.get(0).getBoundingClientRect().height;
    }

    const { OVERSCAN } = TrackList;
    const top = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const first = Math.max(0, Math.floor(-top / this.rowHeight) - OVERSCAN);
    const last = Math.max(first, Math.min(
      tracks.length,
      Math.ceil((scroller.clientHeight - top) / this.rowHeight) + OVERSCAN,
    ));

    for (const [index, item] of rendered) {
      if (index < first || index >= last) {
        item.remove();
        rendered.delete(index);
      }
    }

    let next = null;
    let added = false;
    for (let index = last - 1; index >= first; index -= 1) {
      let item = rendered.get(index);
      if (!item) {
        item = this.createItem(index);
        list.insertBefore(item, next);
        added = true;
      }
      next = item;
    }

    list.style.paddingTop = `${first * this.rowHeight}px`;
    list.style.height = `${tracks.length * this.rowHeight}px`;
    if (added) quadPlayer.markCurrentRow();
  }

  showCover(collection) {
    this.frame.classList.toggle('is-round', collection.kind === 'artist');
    this.cover.replaceChildren();
    this.glow.removeAttribute('src');
    if (!collection.cover) return;

    const image = document.createElement('img');
    image.src = collection.cover;
    image.alt = '';
    this.cover.append(image);
    this.glow.src = collection.cover;
  }

  // У коллекции без своей обложки она собирается из обложек первых треков.
  showMosaic() {
    const covers = [...new Set(this.tracks.map((track) => track.coverMedium).filter(Boolean))]
      .slice(0, TrackList.MOSAIC_SIZE);
    if (covers.length < TrackList.MOSAIC_SIZE) return;

    this.cover.replaceChildren(...covers.map((cover) => {
      const image = document.createElement('img');
      image.src = cover;
      image.alt = '';
      return image;
    }));
    this.cover.classList.add('is-mosaic');
    [this.glow.src] = covers;
  }

  replayFrame() {
    this.frame.classList.remove('is-open');
    this.frame.getBoundingClientRect();
    this.frame.classList.add('is-open');
  }

  open(collection) {
    this.request += 1;
    this.collection = collection;
    this.tracks = [];
    this.nextOffset = 0;
    this.loading = false;
    this.order = this.loadOrder();
    this.ranks = new Map();
    this.anchor = -1;
    this.lastIncoming = null;

    this.title.textContent = collection.title;
    this.subtitle.textContent = collection.subtitle ?? '';
    this.cover.classList.remove('is-mosaic');
    this.showCover(collection);
    this.replayFrame();
    this.playButton.disabled = true;
    this.shuffleButton.disabled = true;
    this.onRemove = collection.provider === 'quad' ? (track) => this.removeTrack(track) : undefined;
    this.clearRows();
    this.scroller.scrollTop = 0;

    this.list.classList.add('is-fresh');
    clearTimeout(this.freshTimer);
    this.freshTimer = setTimeout(() => this.list.classList.remove('is-fresh'), TrackList.FRESH_MS);
    return this.loadMore();
  }

  // Только свои плейлисты: номера и порядок пересобираются заново, прокрутка остаётся на месте.
  async removeTrack(track) {
    const { collection, scroller } = this;
    const position = scroller.scrollTop;
    const count = this.tracks.length - 1;

    await music.togglePlaylistTrack(collection.id, track);
    await this.open({
      ...collection,
      subtitle: `${count} ${quadPlayer.plural(count, 'трек', 'трека', 'треков')}`,
    });
    scroller.scrollTop = position;
    document.dispatchEvent(new CustomEvent('quad:library-changed'));
  }

  async loadMore() {
    if (this.loading || this.nextOffset === null) return;
    this.loading = true;
    const { request, collection } = this;
    const id = collection.collectionId ?? collection.id;

    try {
      const page = await music.collection(collection.provider, id, this.nextOffset);
      if (request !== this.request) return;

      const firstIndex = this.tracks.length;
      const moved = quadPlayer.reorderQueue(this.tracks, () => this.merge(page.tracks));
      this.nextOffset = page.nextOffset;
      if (moved) this.resetRendered();
      this.renderWindow();

      if (firstIndex === 0 && !collection.cover) this.showMosaic();
      if (this.tracks.length === 0 && collection.emptyText) {
        const note = document.createElement('li');
        note.className = 'tracks-empty';
        note.textContent = collection.emptyText;
        this.list.append(note);
      }
      this.playButton.disabled = this.tracks.length === 0;
      this.shuffleButton.disabled = this.tracks.length === 0;
      quadPlayer.markCurrentRow();
      if (quadPlayer.currentTrack()) quadPlayer.renderQueue();
    } catch {
      if (request === this.request) this.nextOffset = null;
    } finally {
      if (request === this.request) this.loading = false;
    }
  }

  /* Свой порядок */

  static keyOf(track) {
    return `${track.provider}:${track.id}`;
  }

  orderKey() {
    const { collection } = this;
    return `${TrackList.ORDER_PREFIX}${collection.provider}:${collection.collectionId ?? collection.id}`;
  }

  // Свои плейлисты хранят порядок сами, для остальных он запоминается здесь.
  loadOrder() {
    if (!this.reorderable || this.collection.provider === 'quad') return null;
    try {
      const keys = JSON.parse(localStorage.getItem(this.orderKey()) ?? 'null');
      return Array.isArray(keys) ? new Map(keys.map((key, index) => [key, index])) : null;
    } catch {
      return null;
    }
  }

  // Новая страница встаёт по сохранённому порядку. Трек, которого в нём нет (свежий лайк или ещё
  // не загруженный при перестановке), держится рядом со своим соседом по списку сервиса.
  // Возвращает true, если что-то встало не в конец: тогда строки надо пересобрать.
  merge(incoming) {
    if (!this.order) {
      this.tracks.push(...incoming);
      this.lastIncoming = incoming.at(-1) ?? this.lastIncoming;
      return false;
    }

    let moved = false;
    for (const track of incoming) {
      const saved = this.order.get(TrackList.keyOf(track));
      const rank = saved ?? this.anchor + 0.5;
      if (saved !== undefined) this.anchor = saved;
      this.ranks.set(track, rank);

      let at = this.tracks.length;
      while (at > 0 && (this.ranks.get(this.tracks[at - 1]) ?? -Infinity) > rank) at -= 1;
      if (at < this.tracks.length) moved = true;
      this.tracks.splice(at, 0, track);
      this.lastIncoming = track;
    }
    return moved;
  }

  saveOrder() {
    const { collection, tracks } = this;
    const keys = tracks.map(TrackList.keyOf);

    if (collection.provider === 'quad') {
      music.reorderPlaylist(collection.id, keys)
        .then(() => document.dispatchEvent(new CustomEvent('quad:library-changed')))
        .catch(() => quadPlayer.showToast('Не удалось сохранить порядок'));
      return;
    }

    this.order = new Map(keys.map((key, index) => [key, index]));
    this.ranks = new Map(tracks.map((track, index) => [track, index]));
    this.anchor = this.lastIncoming ? tracks.indexOf(this.lastIncoming) : tracks.length - 1;
    try {
      localStorage.setItem(this.orderKey(), JSON.stringify(keys));
    } catch {
      quadPlayer.showToast('Не удалось запомнить порядок');
    }
  }

  // Строки помнят свой номер, поэтому после перестановки собираются заново. Высота строки та же.
  resetRendered() {
    for (const item of this.rendered.values()) item.remove();
    this.rendered.clear();
  }

  /* Перетаскивание */

  enableDrag() {
    this.list.classList.add('is-sortable');
    this.list.addEventListener('pointerdown', (event) => this.press(event));

    // Обложку браузер сам тащит как картинку, а это перебивает перестановку.
    this.list.addEventListener('dragstart', (event) => event.preventDefault());

    // Отпущенная после перетаскивания кнопка мыши не должна включать трек.
    this.list.addEventListener('click', (event) => {
      if (!this.suppressClick) return;
      this.suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  press(event) {
    if (event.button !== 0 || this.drag || this.tracks.length < 2) return;
    const row = event.target.closest('.track-row');
    if (!row || event.target.closest('.row-actions, .artist-link, .album-link')) return;
    const item = row.parentElement;
    const index = Number(item.dataset.index);
    if (!Number.isInteger(index) || !this.tracks[index]) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const move = (moveEvent) => {
      if (!this.drag) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < TrackList.DRAG_START_PX) return;
        this.beginDrag(index, item, row, startY);
      }
      this.pointerY = moveEvent.clientY;
      this.updateDrag();
    };
    const stop = (commit) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      if (this.drag) this.finishDrag(commit);
    };
    const release = () => stop(true);
    const cancel = () => stop(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
  }

  beginDrag(index, item, row, startY) {
    const box = row.getBoundingClientRect();

    const ghost = document.createElement('li');
    ghost.className = 'track-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    const copy = row.cloneNode(true);
    copy.classList.remove('is-current');
    copy.removeAttribute('tabindex');
    copy.removeAttribute('role');
    copy.removeAttribute('data-key');
    ghost.append(copy);

    const marker = document.createElement('li');
    marker.className = 'track-drop-line';
    marker.setAttribute('aria-hidden', 'true');
    this.list.append(ghost, marker);

    this.drag = {
      track: this.tracks[index],
      to: index,
      grab: startY - box.top,
      ghost,
      marker,
      scrollFrame: 0,
    };
    item.classList.add('is-drag-source');
    this.list.classList.add('is-reordering');
    document.body.classList.add('is-reordering');
    window.getSelection()?.removeAllRanges();
    this.autoScroll();
  }

  updateDrag() {
    const { drag, list, rowHeight, tracks } = this;
    if (!drag || rowHeight === 0) return;
    const y = this.pointerY - list.getBoundingClientRect().top;
    const top = Math.max(0, Math.min(tracks.length * rowHeight - rowHeight, y - drag.grab));
    drag.to = Math.max(0, Math.min(tracks.length, Math.round((top + rowHeight / 2) / rowHeight)));
    drag.ghost.style.transform = `translateY(${top}px)`;
    drag.marker.style.transform = `translateY(${drag.to * rowHeight}px)`;
  }

  // У краёв списка он сам листается, чтобы трек можно было унести далеко.
  autoScroll() {
    const { drag, scroller } = this;
    if (!drag) return;
    const { SCROLL_EDGE, SCROLL_SPEED } = TrackList;
    const box = scroller.getBoundingClientRect();
    const fromTop = this.pointerY - box.top;
    const fromBottom = box.bottom - this.pointerY;
    let speed = 0;
    if (fromTop < SCROLL_EDGE) speed = -SCROLL_SPEED * (1 - Math.max(0, fromTop) / SCROLL_EDGE);
    else if (fromBottom < SCROLL_EDGE) speed = SCROLL_SPEED * (1 - Math.max(0, fromBottom) / SCROLL_EDGE);
    if (speed !== 0) {
      scroller.scrollTop += speed;
      this.updateDrag();
    }
    drag.scrollFrame = requestAnimationFrame(() => this.autoScroll());
  }

  finishDrag(commit) {
    const { track, to, ghost, marker, scrollFrame } = this.drag;
    cancelAnimationFrame(scrollFrame);
    ghost.remove();
    marker.remove();
    this.list.querySelectorAll('.is-drag-source').forEach((item) => item.classList.remove('is-drag-source'));
    this.list.classList.remove('is-reordering');
    document.body.classList.remove('is-reordering');
    this.drag = null;

    // Клик приходит сразу после отпускания кнопки, в той же очереди событий.
    this.suppressClick = true;
    setTimeout(() => {
      this.suppressClick = false;
    }, 0);

    if (!commit) return;
    const from = this.tracks.indexOf(track);
    const target = to > from ? to - 1 : to;
    if (from < 0 || target === from) return;

    quadPlayer.reorderQueue(this.tracks, () => {
      this.tracks.splice(from, 1);
      this.tracks.splice(target, 0, track);
    });
    this.resetRendered();
    this.renderWindow();
    this.saveOrder();
  }
}
