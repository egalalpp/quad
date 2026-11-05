const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

// Токен нужен каждому запросу, поэтому расшифровывается один раз за запуск.
const tokens = new Map();

function tokenPath(providerId) {
  return path.join(app.getPath('userData'), 'tokens', `${providerId}.bin`);
}

async function write(providerId, token) {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('Шифрование недоступно, токен не сохранён');
  }
  const file = tokenPath(providerId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, await safeStorage.encryptStringAsync(token));
  tokens.set(providerId, Promise.resolve(token));
}

async function decrypt(providerId) {
  try {
    const encrypted = await fs.readFile(tokenPath(providerId));
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(encrypted);
    if (shouldReEncrypt) await write(providerId, result);
    return result;
  } catch {
    return null;
  }
}

function read(providerId) {
  if (!tokens.has(providerId)) tokens.set(providerId, decrypt(providerId));
  return tokens.get(providerId);
}

async function remove(providerId) {
  tokens.set(providerId, Promise.resolve(null));
  await fs.rm(tokenPath(providerId), { force: true });
}

module.exports = { read, write, remove };
