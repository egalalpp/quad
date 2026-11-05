const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ALL,
  missingMethods,
  planned,
  scopeOf,
  services,
} = require('../src/providers');

const yandex = { id: 'yandex' };
const soundcloud = { id: 'soundcloud' };
const connected = [yandex, soundcloud];

test('каждый сервис умеет всё, что нужно экранам и волне', () => {
  services.forEach((provider) => {
    assert.deepEqual(missingMethods(provider), [], provider.id);
    assert.ok(provider.name, provider.id);
    assert.ok(provider.mediaHosts.length > 0, provider.id);
  });
});

test('без нужного метода сервис не проходит проверку', () => {
  const { search: _search, ...broken } = services[0];
  assert.deepEqual(missingMethods(broken), ['search']);
});

test('номера сервисов не повторяются и не совпадают с внутренними источниками', () => {
  const ids = [...services, ...planned].map((service) => service.id);
  assert.equal(new Set(ids).size, ids.length);
  ['quad', 'downloads', ALL].forEach((id) => assert.ok(!ids.includes(id), id));
});

test('выбранный сервис отсекает остальные', () => {
  assert.deepEqual(scopeOf(connected, 'soundcloud'), [soundcloud]);
  assert.deepEqual(scopeOf(connected, 'yandex'), [yandex]);
});

test('без выбора работают все подключённые', () => {
  assert.deepEqual(scopeOf(connected, ALL), connected);
  assert.deepEqual(scopeOf(connected), connected);
});

test('отключённый сервис не оставляет без музыки', () => {
  assert.deepEqual(scopeOf([yandex], 'soundcloud'), [yandex]);
  assert.deepEqual(scopeOf([], 'soundcloud'), []);
});
