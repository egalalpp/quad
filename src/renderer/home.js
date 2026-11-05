(() => {
  const ROWS = 4;
  const TILE_GAP = 14;
  const SMALLEST_TILE = 150;
  const LARGEST_TILE = 300;
  const TILE_HEIGHT_SHARE = 0.27;

  // Стена шире окна и повёрнута, плюс запас обложек для переезда с края на край.
  const WALL_COVERAGE = 1.4;
  const SPARE_TILES = 3;
  const PARALLAX = 26;

  // Случайные треки подгружаются заранее, чтобы при листании не кончались.
  const FIRST_BATCH = 120;
  const NEXT_BATCH = 60;
  const REFILL_AT = 30;

  // Скорости в пикселях за миллисекунду.
  const DRIFT = 0.02;
  const WHEEL_FORCE = 0.012;
  const MAX_SPEED = 6;
  const FRICTION = 0.94;

  const home = document.getElementById('view-home');
  const wall = document.getElementById('home-wall');
  const title = document.getElementById('home-title');
  const stats = document.getElementById('home-stats');
  const caption = document.getElementById('home-caption');
  const secondButton = document.getElementById('home-second');
  const mixButton = document.getElementById('home-mix');

  // Ссылка на этот массив становится очередью, поэтому новые треки дописываются в него же.
  let pool = [];
  let cursor = 0;
  let refilling = false;
  let rows = [];
  let lastFrame = 0;
  let request = 0;

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 5) return 'Доброй ночи';
    if (hour < 12) return 'Доброе утро';
    if (hour < 18) return 'Добрый день';
    return 'Добрый вечер';
  }

  /* Случайные треки */

  async function refill() {
    if (refilling) return;
    refilling = true;
    const current = request;
    try {
      const tracks = await music.random(NEXT_BATCH);
      if (current === request) pool.push(...tracks.filter((track) => track.coverMedium));
    } catch {
      // Если сеть пропала, стена просто идёт по кругу из того, что уже есть.
    } finally {
      refilling = false;
    }
  }

  function nextIndex() {
    const index = cursor % pool.length;
    cursor += 1;
    if (pool.length - cursor < REFILL_AT) refill();
    return index;
  }

  function fillTile(tile) {
    const index = nextIndex();
    tile.dataset.index = index;
    tile.firstElementChild.src = pool[index].coverMedium;
  }

  /* Стена */

  function createTile() {
    const tile = document.createElement('button');
    tile.className = 'home-tile';
    tile.tabIndex = -1;

    const image = document.createElement('img');
    image.alt = '';
    image.decoding = 'async';
    tile.append(image);
    fillTile(tile);

    tile.addEventListener('pointerenter', () => {
      const track = pool[tile.dataset.index];
      caption.textContent = `${track.title} — ${track.artists}`;
      caption.classList.add('is-visible');
    });
    tile.addEventListener('pointerleave', () => caption.classList.remove('is-visible'));
    tile.addEventListener('click', () => quadPlayer.play(pool, Number(tile.dataset.index)));
    return tile;
  }

  // Размер обложки задан в CSS через высоту окна, здесь та же формула.
  function tilesNeeded() {
    const tile = Math.min(LARGEST_TILE, Math.max(SMALLEST_TILE, window.innerHeight * TILE_HEIGHT_SHARE));
    return Math.ceil((window.innerWidth * WALL_COVERAGE) / (tile + TILE_GAP)) + SPARE_TILES;
  }

  // Окно растянули: обложек должно хватить на новую ширину.
  function addMissingTiles() {
    const count = tilesNeeded();
    for (const { element } of rows) {
      while (element.childElementCount < count) element.append(createTile());
    }
  }

  function createRow(rowIndex) {
    const element = document.createElement('div');
    element.className = 'home-row';
    element.append(...Array.from({ length: tilesNeeded() }, createTile));

    const row = {
      element,
      offset: 0,
      speed: 0,
      drift: rowIndex % 2 === 0 ? DRIFT : -DRIFT * 0.8,
      hovered: false,
    };

    element.addEventListener('pointerenter', () => {
      row.hovered = true;
    });
    element.addEventListener('pointerleave', () => {
      row.hovered = false;
    });
    element.addEventListener('wheel', (event) => {
      const next = row.speed + event.deltaY * WHEEL_FORCE;
      row.speed = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, next));
    }, { passive: true });

    return row;
  }

  // Обложка, ушедшая за край, переезжает на другой конец ряда уже с новым случайным треком.
  function recycle(row) {
    const { element } = row;
    const step = element.firstElementChild.offsetWidth + TILE_GAP;

    while (row.offset >= step) {
      const tile = element.firstElementChild;
      fillTile(tile);
      element.append(tile);
      row.offset -= step;
    }
    while (row.offset < 0) {
      const tile = element.lastElementChild;
      fillTile(tile);
      element.prepend(tile);
      row.offset += step;
    }
  }

  function frame(now) {
    const ms = Math.min(now - lastFrame, 50);
    lastFrame = now;

    if (home.classList.contains('is-active') && !document.body.classList.contains('page-open')) {
      const friction = FRICTION ** (ms / 16.7);
      for (const row of rows) {
        row.speed *= friction;
        row.offset += (row.speed + (row.hovered ? 0 : row.drift)) * ms;
        recycle(row);
        row.element.style.transform = `translate3d(${-row.offset}px, 0, 0)`;
      }
    }
    requestAnimationFrame(frame);
  }

  function renderWall() {
    cursor = 0;
    rows = Array.from({ length: ROWS }, (_row, index) => createRow(index));
    wall.replaceChildren(...rows.map((row) => row.element));
  }

  /* Экран */

  function showWelcome() {
    pool = [];
    rows = [];
    wall.replaceChildren();
    title.textContent = 'Вся музыка в одном месте';
    stats.textContent = '';
    secondButton.textContent = 'Подключить аккаунт';
    secondButton.dataset.target = 'accounts';
    mixButton.hidden = true;
  }

  async function load() {
    request += 1;
    const current = request;

    if (!quadPlayer.hasAccount()) {
      showWelcome();
      return;
    }

    const name = quadPlayer.connectedAccount()?.account;
    title.textContent = name ? `${greeting()}, ${name}` : greeting();

    try {
      const [collections, tracks] = await Promise.all([music.library(), music.random(FIRST_BATCH)]);
      if (current !== request) return;

      const liked = collections.filter((collection) => collection.id === 'liked')
        .reduce((total, collection) => total + collection.count, 0);
      const playlists = collections.filter((collection) => (
        collection.id !== 'liked' && collection.provider !== 'downloads'
      )).length;

      pool = tracks.filter((track) => track.coverMedium);
      stats.textContent = [
        `${liked} ${quadPlayer.plural(liked, 'трек', 'трека', 'треков')}`,
        `${playlists} ${quadPlayer.plural(playlists, 'плейлист', 'плейлиста', 'плейлистов')}`,
      ].join(' · ');
      secondButton.textContent = 'Медиатека';
      secondButton.dataset.target = 'library';
      mixButton.hidden = liked === 0;
      if (pool.length > 0) renderWall();
    } catch {
      if (current === request) stats.textContent = 'Не удалось загрузить медиатеку';
    }
  }

  secondButton.addEventListener('click', () => {
    document.querySelector(`[data-view="${secondButton.dataset.target}"]`).click();
  });

  window.addEventListener('pointermove', (event) => {
    if (!home.classList.contains('is-active')) return;
    home.style.setProperty('--light-x', `${event.clientX}px`);
    home.style.setProperty('--light-y', `${event.clientY}px`);
    home.style.setProperty('--shift-x', `${(0.5 - event.clientX / window.innerWidth) * PARALLAX}px`);
    home.style.setProperty('--shift-y', `${(0.5 - event.clientY / window.innerHeight) * PARALLAX}px`);
  });

  window.addEventListener('resize', addMissingTiles);
  document.addEventListener('quad:accounts', load);
  requestAnimationFrame(frame);
})();
