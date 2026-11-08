const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DropDetector } = require('../src/renderer/drop-detector');

const HZ_PER_BIN = 48000 / 1024;
const FRAME = 1000 / 60;

// Спектр с заданной громкостью полос, от 0 до 1. Шум делает кадры непохожими друг на друга.
function spectrum({ bass = 0, mid = 0, high = 0 }, noise = 0) {
  const bins = new Uint8Array(512);
  bins.forEach((_value, index) => {
    const hz = index * HZ_PER_BIN;
    let level = 0;
    if (hz >= 30 && hz < 160) level = bass;
    else if (hz >= 300 && hz < 2500) level = mid;
    else if (hz >= 3000 && hz < 14000) level = high;
    bins[index] = Math.round(255 * Math.min(1, level + (Math.random() - 0.5) * noise));
  });
  return bins;
}

// Проигрывает отрезок: seconds секунд одного и того же звука, по кадрам.
function play(detector, seconds, bands, noise = 0) {
  const events = [];
  for (let time = 0; time < seconds * 1000; time += FRAME) {
    detector.update(spectrum(bands, noise), HZ_PER_BIN, FRAME);
    if (detector.dropped) events.push(detector.clock);
  }
  return events;
}

test('после тихого куска бас на пике это дроп', () => {
  const detector = new DropDetector();
  play(detector, 6, { bass: 0.85, mid: 0.6, high: 0.5 });
  play(detector, 4, { bass: 0.2, mid: 0.6, high: 0.6 });
  const drops = play(detector, 3, { bass: 0.88, mid: 0.65, high: 0.55 });
  assert.equal(drops.length, 1);
  assert.equal(detector.drop > 0.3, true);
});

test('ровно громкий трек дропом не считается', () => {
  const detector = new DropDetector();
  assert.deepEqual(play(detector, 30, { bass: 0.8, mid: 0.6, high: 0.5 }, 0.05), []);
});

test('громкое начало трека не дроп', () => {
  const detector = new DropDetector();
  play(detector, 2, { bass: 0.85, mid: 0.6, high: 0.5 });
  detector.reset();
  assert.deepEqual(play(detector, 8, { bass: 0.85, mid: 0.6, high: 0.5 }), []);
});

test('два дропа подряд не идут чаще раза в двенадцать секунд', () => {
  const detector = new DropDetector();
  play(detector, 6, { bass: 0.85, mid: 0.5 });
  let drops = 0;
  for (let round = 0; round < 4; round += 1) {
    play(detector, 2, { bass: 0.15, mid: 0.5 });
    drops += play(detector, 2, { bass: 0.88, mid: 0.5 }).length;
  }
  assert.equal(drops, 2);
});

test('нарастание: верх есть, баса нет', () => {
  const detector = new DropDetector();
  play(detector, 6, { bass: 0.85, mid: 0.6, high: 0.6 });
  play(detector, 3, { bass: 0.1, mid: 0.65, high: 0.7 });
  assert.equal(detector.tension > 0.5, true, String(detector.tension));

  const quiet = new DropDetector();
  play(quiet, 6, { bass: 0.85, mid: 0.6, high: 0.6 });
  play(quiet, 3, { bass: 0.1, mid: 0.1, high: 0.1 });
  assert.equal(quiet.tension < 0.2, true, String(quiet.tension));
});

test('бочка ловится на каждом ударе и не чаще разрешённого', () => {
  const detector = new DropDetector();
  let hits = 0;
  for (let beat = 0; beat < 16; beat += 1) {
    for (let frame = 0; frame < 30; frame += 1) {
      const bass = frame < 4 ? 0.9 : 0.45;
      detector.update(spectrum({ bass, mid: 0.4 }), HZ_PER_BIN, FRAME);
      if (detector.hitNow.kick) hits += 1;
    }
  }
  assert.equal(hits >= 14 && hits <= 16, true, String(hits));
  // Фон рисует не каждый кадр, поэтому удары ещё и считаются: число совпадает с пойманными.
  assert.equal(detector.hits.kick, hits);
});

test('счёт ударов не сбрасывается при смене трека', () => {
  const detector = new DropDetector();
  for (let frame = 0; frame < 30; frame += 1) {
    detector.update(spectrum({ bass: frame < 4 ? 0.9 : 0.45, mid: 0.4 }), HZ_PER_BIN, FRAME);
  }
  const before = detector.hits.kick;
  detector.reset();
  assert.equal(detector.hits.kick, before);
});

test('частота экрана не меняет поведение', () => {
  const countHits = (frameMs) => {
    const detector = new DropDetector();
    let hits = 0;
    const perBeat = Math.round(500 / frameMs);
    for (let beat = 0; beat < 12; beat += 1) {
      for (let frame = 0; frame < perBeat; frame += 1) {
        const bass = frame * frameMs < 60 ? 0.9 : 0.45;
        detector.update(spectrum({ bass, mid: 0.4 }), HZ_PER_BIN, frameMs);
        if (detector.hitNow.kick) hits += 1;
      }
    }
    return hits;
  };
  assert.equal(Math.abs(countHits(1000 / 60) - countHits(1000 / 240)) <= 1, true);
});

test('тишина гасит жар', () => {
  const detector = new DropDetector();
  play(detector, 5, { bass: 0.9, mid: 0.7, high: 0.6 });
  assert.equal(detector.heat > 0.6, true, String(detector.heat));
  play(detector, 6, {});
  assert.equal(detector.heat < 0.05, true, String(detector.heat));
});
