// Страница коллекции: панель с обложкой и кнопками слева, треки справа.
// Используется в Медиатеке и для исполнителей и альбомов из Поиска.
class TrackList {
  static LOAD_MORE_MARGIN = 500;
  static MOSAIC_SIZE = 4;

  // Строки вокруг видимой области: при быстрой прокрутке пустота не успевает показаться.
  static OVERSCAN = 14;

  // Столько длится появление строк при открытии списка. Дальше строки появляются без анимации.
  static FRESH_MS = 900;

  constructor(root) {
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
      this.tracks.push(...page.tracks);
      this.nextOffset = page.nextOffset;
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
}
