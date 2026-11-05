const nav = document.getElementById('nav');
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');
const searchBox = document.getElementById('search-box');
const search = document.getElementById('search');
const title = document.getElementById('title');
const volume = document.getElementById('volume');
const maximizeButton = document.getElementById('win-max');

function moveNavMarker() {
  const active = document.querySelector('.nav-item.is-active');
  nav.style.setProperty('--nav-y', `${active.offsetTop + active.offsetHeight / 2}px`);
}

// Экрана артиста или альбома нет в меню: тогда активным остаётся пункт, откуда на него пришли.
function showView(name, heading) {
  const navItem = document.querySelector(`.nav-item[data-view="${name}"]`);
  if (navItem) navItems.forEach((item) => item.classList.toggle('is-active', item === navItem));
  views.forEach((view) => view.classList.toggle('is-active', view.id === `view-${name}`));
  document.querySelector('.scroll').scrollTop = 0;
  document.body.classList.toggle('on-home', name === 'home' || name === 'wave');
  document.body.classList.toggle('on-wave', name === 'wave');
  document.body.dataset.view = name;

  const isSearch = name === 'search';
  searchBox.hidden = !isSearch;
  title.hidden = isSearch;
  if (isSearch) search.focus();
  else title.textContent = heading ?? navItem.dataset.title;

  moveNavMarker();
  document.dispatchEvent(new CustomEvent('quad:view', { detail: name }));
}

navItems.forEach((item) => {
  item.addEventListener('click', () => showView(item.dataset.view));
});

new ResizeObserver(moveNavMarker).observe(nav);

const isMac = windowControls.platform === 'darwin';
document.documentElement.classList.toggle('is-mac', isMac);
if (isMac) document.querySelector('.hint').textContent = '⌘ K';

document.addEventListener('keydown', (event) => {
  if ((isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    showView('search');
  }
});

volume.addEventListener('input', () => {
  volume.style.setProperty('--value', `${volume.value}%`);
});

document.getElementById('win-min').addEventListener('click', windowControls.minimize);
document.getElementById('win-close').addEventListener('click', windowControls.close);
maximizeButton.addEventListener('click', windowControls.toggleMaximize);

windowControls.onMaximizedChange((isMaximized) => {
  document.body.classList.toggle('is-maximized', isMaximized);
  maximizeButton.setAttribute('aria-label', isMaximized ? 'Свернуть в окно' : 'Развернуть');
});
