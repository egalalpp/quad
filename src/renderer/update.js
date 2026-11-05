// Окно «Вышла новая версия»: показывается при входе, когда заставка уже закончилась.
(() => {
  const FIRST_CHECK_DELAY = 2500;
  const INTRO_POLL = 400;

  const root = document.getElementById('update');
  const version = document.getElementById('update-version');
  const notes = document.getElementById('update-notes');
  const progress = document.getElementById('update-progress');
  const bar = progress.firstElementChild;
  const installButton = document.getElementById('update-now');
  const laterButton = document.getElementById('update-later');
  const appVersion = document.getElementById('app-version');
  const checkButton = document.getElementById('update-check');

  let offer = null;

  function hide() {
    root.classList.remove('is-visible');
    setTimeout(() => {
      root.hidden = true;
    }, 320);
  }

  function setBusy(busy) {
    installButton.disabled = busy;
    laterButton.hidden = busy;
    progress.hidden = !busy;
  }

  function show(found) {
    offer = found;
    version.textContent = found.version;
    notes.textContent = found.notes;
    notes.hidden = found.notes === '';
    installButton.textContent = found.canInstall ? 'Обновить' : 'Открыть страницу';
    setBusy(false);
    bar.style.transform = 'scaleX(0)';
    root.hidden = false;
    root.getBoundingClientRect();
    root.classList.add('is-visible');
  }

  function showWhenIntroEnds(found) {
    if (document.body.classList.contains('intro-active')) {
      setTimeout(() => showWhenIntroEnds(found), INTRO_POLL);
      return;
    }
    show(found);
  }

  async function checkOnStart() {
    const found = await quadUpdate.check().catch(() => null);
    if (found) showWhenIntroEnds(found);
  }

  async function install() {
    if (!offer.canInstall) {
      quadUpdate.openPage();
      hide();
      return;
    }

    setBusy(true);
    installButton.textContent = 'Скачиваю';
    try {
      await quadUpdate.install();
      installButton.textContent = 'Перезапускаю';
    } catch {
      setBusy(false);
      installButton.textContent = 'Открыть страницу';
      notes.hidden = false;
      notes.textContent = 'Не получилось скачать. Можно поставить вручную со страницы релиза.';
      offer = { ...offer, canInstall: false };
    }
  }

  installButton.addEventListener('click', install);
  laterButton.addEventListener('click', hide);
  quadUpdate.onProgress((share) => {
    bar.style.transform = `scaleX(${share})`;
  });

  appVersion.textContent = `Версия ${quadUpdate.version}`;
  checkButton.addEventListener('click', async () => {
    checkButton.textContent = 'Проверяю';
    const found = await quadUpdate.check().catch(() => undefined);
    if (found) show(found);
    else quadPlayer.showToast(found === null ? 'Это последняя версия' : 'Не удалось проверить обновления');
    checkButton.textContent = 'Проверить обновления';
  });

  setTimeout(checkOnStart, FIRST_CHECK_DELAY);
})();
