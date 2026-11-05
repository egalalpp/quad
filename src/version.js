// Сравнение версий вида 1.2.3. Отдельно от Electron, чтобы проверялось обычными тестами.
function parts(version) {
  return version.replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
}

function isNewer(candidate, current) {
  const next = parts(candidate);
  const now = parts(current);
  for (let index = 0; index < Math.max(next.length, now.length); index += 1) {
    const difference = (next[index] ?? 0) - (now[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

module.exports = { isNewer };
