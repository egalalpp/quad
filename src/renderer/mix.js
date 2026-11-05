// «Миксануть»: все твои треки вразнобой, без повторов, очередь дополняется сама.
(() => {
  const BATCH = 60;
  const REFILL_AT = 10;

  const button = document.getElementById('home-mix');

  // Ссылка на этот массив становится очередью, поэтому новые треки дописываются в него же.
  let queue = null;
  let loading = false;

  const keyOf = (track) => `${track.provider}:${track.id}`;
  const isActive = () => queue !== null && quadPlayer.queueIs(queue);
  const load = () => music.mix(BATCH, queue.map(keyOf));

  async function refill() {
    if (loading) return;
    loading = true;
    try {
      const tracks = await load();
      if (!isActive()) return;
      queue.push(...tracks);
      quadPlayer.renderQueue();
    } catch {
      // Попробует ещё раз на следующем треке.
    } finally {
      loading = false;
    }
  }

  async function start() {
    if (loading) return;
    loading = true;
    queue = [];
    button.classList.add('is-mixing');
    try {
      const tracks = await load();
      queue.push(...tracks);
      if (tracks.length > 0) quadPlayer.play(queue, 0);
    } catch {
      quadPlayer.showToast('Не удалось собрать микс');
    } finally {
      loading = false;
      button.classList.remove('is-mixing');
    }
  }

  button.addEventListener('click', start);

  document.addEventListener('quad:track', () => {
    if (isActive() && queue.length - quadPlayer.queueIndex() <= REFILL_AT) refill();
  });
})();
