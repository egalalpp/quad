// Переключатель сервисов. Поиск, медиатека и волна выбирают и помнят источник независимо друг от друга.
// Кнопки строятся из подключённых аккаунтов, поэтому новый сервис появится здесь сам.
class SourceSwitch {
  static ALL = 'all';

  constructor(box, { storageKey, allLabel = 'Все', preferAll = false, onChange }) {
    this.box = box;
    this.storageKey = storageKey;
    this.allLabel = allLabel;
    this.preferAll = preferAll;
    this.onChange = onChange;
    this.saved = localStorage.getItem(storageKey);

    this.marker = document.createElement('span');
    this.marker.className = 'source-marker';
    box.classList.add('source-switch');

    // Сработает и в тот момент, когда скрытый переключатель появится на экране.
    new ResizeObserver(() => this.moveMarker()).observe(box);
    document.addEventListener('quad:accounts', () => this.render());
    this.render();
  }

  get value() {
    const services = quadPlayer.services();
    if (this.saved === SourceSwitch.ALL || services.some(({ id }) => id === this.saved)) return this.saved;
    return this.preferAll ? SourceSwitch.ALL : services[0]?.id ?? SourceSwitch.ALL;
  }

  // Скачанное и свои плейлисты принадлежат Quad, а не сервису, поэтому видны при любом выборе.
  includes(provider) {
    const { value } = this;
    return value === SourceSwitch.ALL
      || value === provider
      || !quadPlayer.services().some(({ id }) => id === provider);
  }

  select(id) {
    if (id === this.value) return;
    this.saved = id;
    localStorage.setItem(this.storageKey, id);
    this.showActive();
    this.onChange();
  }

  option({ id, name }) {
    const button = document.createElement('button');
    button.className = 'source-option';
    button.textContent = name;
    button.dataset.source = id;
    button.addEventListener('click', () => this.select(id));
    return button;
  }

  showActive() {
    const { value } = this;
    this.box.querySelectorAll('.source-option').forEach((button) => {
      const isActive = button.dataset.source === value;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
    this.moveMarker();
  }

  moveMarker() {
    const active = this.box.querySelector('.source-option.is-active');
    if (!active || active.offsetWidth === 0) return;
    this.marker.style.width = `${active.offsetWidth}px`;
    this.marker.style.transform = `translateX(${active.offsetLeft}px)`;
    this.marker.classList.add('is-placed');
  }

  // Выбирать есть из чего, только когда подключено хотя бы два сервиса.
  render() {
    const services = quadPlayer.services();
    this.box.hidden = services.length < 2;
    this.box.replaceChildren(
      this.marker,
      ...[{ id: SourceSwitch.ALL, name: this.allLabel }, ...services].map((item) => this.option(item)),
    );
    this.showActive();
  }
}
