const assert = require('node:assert/strict');
const { test } = require('node:test');
const { isNewer } = require('../src/version');

test('новая версия определяется по числам, а не по тексту', () => {
  assert.equal(isNewer('v0.10.0', '0.9.0'), true);
  assert.equal(isNewer('0.2.1', '0.2.0'), true);
  assert.equal(isNewer('1.0.0', '0.99.99'), true);
});

test('микрообновление с четвёртым числом новее своей версии и старше следующей', () => {
  assert.equal(isNewer('v0.2.3.1', '0.2.3'), true);
  assert.equal(isNewer('v0.2.3.1', '0.2.3.1'), false);
  assert.equal(isNewer('v0.2.4', '0.2.3.1'), true);
  assert.equal(isNewer('v0.2.3', '0.2.3.1'), false);
});

test('такая же и старая версии обновлением не считаются', () => {
  assert.equal(isNewer('v0.2.0', '0.2.0'), false);
  assert.equal(isNewer('0.1.9', '0.2.0'), false);
  assert.equal(isNewer('0.2', '0.2.0'), false);
});
