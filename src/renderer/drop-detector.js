// Что сейчас происходит в музыке: удары, насколько громкий кусок, нарастание и дроп.
// Сравнивает звук с недавним прошлым этого же трека, поэтому не зависит от громкости и жанра.
// Только расчёты: на вход спектр, на выход числа от 0 до 1, которые рисует фон волны.
class DropDetector {
  static BANDS = { bass: [35, 130], mid: [400, 2200], high: [3500, 12000] };

  // Полураспад следящих средних, мс.
  static FAST = 45;
  static ONSET = 130;
  static RECENT = 1800;
  static PEAK = 45000;

  // Первые секунды трека только слушаем: громкое начало не дроп.
  static WARMUP = 3500;

  // Удар: резкий рывок спектра полосы на фоне её обычной дрожи. Рывок ловит бочку и поверх
  // тянущегося баса, где сама громкость почти не меняется.
  static HITS = {
    kick: { band: 'bass', gap: 130, decay: 120 },
    snare: { band: 'mid', gap: 150, decay: 95 },
    hat: { band: 'high', gap: 80, decay: 60 },
  };
  static FLUX_MEMORY = 450;
  static FLUX_RATIO = 3;
  static FLUX_FLOOR = 0.02;
  static FRAME = 16.7;

  // Дроп: бас почти на пике трека, и перед этим его заметно не хватало.
  static DROP_NEAR_PEAK = 0.86;
  static DROP_JUMP = 0.17;
  static DROP_GAP = 12000;
  static DROP_RELEASE = 2600;

  // Жар: куски, что громче этого доли от пика, начинают разогревать фон.
  static HEAT_FROM = 0.68;
  static HEAT_TO = 0.97;
  static HEAT_RISE = 90;
  static HEAT_FALL = 1100;

  static TENSION_RISE = 900;
  static TENSION_FALL = 380;

  constructor() {
    this.ranges = null;
    this.previous = null;
    this.reset();
    this.peak = { bass: 0.4, mid: 0.4, high: 0.4 };
  }

  // Пики остаются от прошлого трека: так новый сразу сравнивается хоть с чем-то.
  reset(warmup = DropDetector.WARMUP) {
    this.clock = 0;
    this.warmup = warmup;
    this.fast = { bass: 0, mid: 0, high: 0 };
    this.onset = { bass: 0, mid: 0, high: 0 };
    this.recent = { bass: 0, mid: 0, high: 0 };
    this.flux = { bass: 0, mid: 0, high: 0 };
    this.lastHit = { kick: -Infinity, snare: -Infinity, hat: -Infinity };
    this.lastDrop = -Infinity;
    this.kick = 0;
    this.snare = 0;
    this.hat = 0;
    this.heat = 0;
    this.tension = 0;
    this.drop = 0;
    this.dropped = false;
    this.hitNow = { kick: false, snare: false, hat: false };
    // Счёт ударов не сбрасывается: фон рисует не каждый кадр и узнаёт о новом ударе по смене числа.
    this.hits ??= { kick: 0, snare: 0, hat: 0 };
  }

  static follow(current, target, ms, halfLife) {
    return current + (target - current) * (1 - 0.5 ** (ms / halfLife));
  }

  static clamp01(value) {
    return Math.min(1, Math.max(0, value));
  }

  rangesFor(hzPerBin) {
    if (this.ranges?.hzPerBin === hzPerBin) return this.ranges;
    const ranges = { hzPerBin };
    for (const [name, [from, to]] of Object.entries(DropDetector.BANDS)) {
      ranges[name] = [Math.max(1, Math.round(from / hzPerBin)), Math.round(to / hzPerBin)];
    }
    this.ranges = ranges;
    return ranges;
  }

  // Значения спектра уже в децибелах, поэтому среднее по полосе и есть её громкость на слух.
  static level(bins, [first, last]) {
    let sum = 0;
    for (let i = first; i <= last; i += 1) sum += bins[i];
    return sum / (last - first + 1) / 255;
  }

  trackBands(bins, hzPerBin, ms) {
    const { FAST, ONSET, RECENT, PEAK, follow } = DropDetector;
    const ranges = this.rangesFor(hzPerBin);

    // Пока идёт прогрев, недавнее прошлое догоняет звук быстро, иначе начало трека сойдёт за прыжок.
    const recentLife = this.clock < this.warmup ? ONSET : RECENT;
    for (const name of Object.keys(DropDetector.BANDS)) {
      const level = DropDetector.level(bins, ranges[name]);
      this.fast[name] = follow(this.fast[name], level, ms, FAST);
      this.onset[name] = follow(this.onset[name], level, ms, ONSET);
      this.recent[name] = follow(this.recent[name], level, ms, recentLife);
      this.peak[name] = Math.max(this.fast[name], this.peak[name] * 0.5 ** (ms / PEAK));
    }
  }

  // Рост спектра за кадр. Приводится к одной длине кадра, чтобы не зависеть от частоты экрана.
  static rise(bins, previous, [first, last], ms) {
    let sum = 0;
    for (let i = first; i <= last; i += 1) sum += Math.max(0, bins[i] - previous[i]);
    return (sum / (last - first + 1) / 255) * (DropDetector.FRAME / ms);
  }

  trackHits(bins, ms) {
    const { FLUX_MEMORY, FLUX_RATIO, FLUX_FLOOR, HITS, clamp01, follow, rise } = DropDetector;
    this.previous ??= new Uint8Array(bins.length);

    for (const [name, { band, gap, decay }] of Object.entries(HITS)) {
      const jump = rise(bins, this.previous, this.ranges[band], ms);
      const usual = this.flux[band];
      const isHit = jump > usual * FLUX_RATIO + FLUX_FLOOR && this.clock - this.lastHit[name] > gap;
      this.flux[band] = follow(usual, jump, ms, FLUX_MEMORY);

      this.hitNow[name] = isHit;
      if (isHit) {
        this.lastHit[name] = this.clock;
        this.hits[name] += 1;
      }
      const strength = isHit ? clamp01(0.35 + (jump - usual * FLUX_RATIO) * 5) : 0;
      this[name] = Math.max(strength, this[name] * 0.5 ** (ms / decay));
    }
    this.previous.set(bins);
  }

  trackHeat(ms) {
    const { HEAT_FROM, HEAT_TO, HEAT_RISE, HEAT_FALL, clamp01, follow } = DropDetector;
    const share = (0.6 * this.fast.bass + 0.25 * this.fast.mid + 0.15 * this.fast.high)
      / (0.6 * this.peak.bass + 0.25 * this.peak.mid + 0.15 * this.peak.high);
    const target = clamp01((share - HEAT_FROM) / (HEAT_TO - HEAT_FROM));
    this.heat = follow(this.heat, target, ms, target > this.heat ? HEAT_RISE : HEAT_FALL);
  }

  // Нарастание: верх и середина на месте, а баса нет. Так звучит почти любой подход к дропу.
  trackTension(ms) {
    const { TENSION_RISE, TENSION_FALL, clamp01, follow } = DropDetector;
    const missingBass = clamp01((0.9 - this.fast.bass / this.peak.bass) / 0.45);
    const upper = Math.max(this.recent.mid / this.peak.mid, this.recent.high / this.peak.high);
    const target = missingBass * clamp01((upper - 0.45) / 0.4);
    this.tension = follow(this.tension, target, ms, target > this.tension ? TENSION_RISE : TENSION_FALL);
  }

  trackDrop(ms) {
    const { DROP_NEAR_PEAK, DROP_JUMP, DROP_GAP, DROP_RELEASE } = DropDetector;
    const { fast, recent, peak } = this;
    const isReady = this.clock > this.warmup && this.clock - this.lastDrop > DROP_GAP;
    this.dropped = isReady
      && fast.bass > peak.bass * DROP_NEAR_PEAK
      && fast.bass - recent.bass > DROP_JUMP;

    if (this.dropped) {
      this.lastDrop = this.clock;
      this.drop = 1;
      this.tension = 0;
    } else {
      this.drop *= 0.5 ** (ms / DROP_RELEASE);
    }
  }

  update(bins, hzPerBin, ms) {
    this.clock += ms;
    this.trackBands(bins, hzPerBin, ms);
    this.trackHits(bins, ms);
    this.trackHeat(ms);
    this.trackTension(ms);
    this.trackDrop(ms);
    return this;
  }
}

if (typeof module !== 'undefined') module.exports = { DropDetector };
