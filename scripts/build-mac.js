// Собирает Quad для Mac прямо на Windows, не распаковывая файлы на диск:
// символьные ссылки внутри приложения Mac на Windows без прав разработчика не создать.
// Берёт готовый Electron для Mac и кладёт в него наш app.asar, значок и название.
// Запуск после npm run package: node scripts/build-mac.js
const fs = require('node:fs');
const path = require('node:path');
const { downloadArtifact } = require('@electron/get');
const yauzl = require('yauzl');
const yazl = require('yazl');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const ASAR = path.join(ROOT, 'dist', 'Quad-win32-x64', 'resources', 'app.asar');
const ICON = path.join(ROOT, 'assets', 'icon.icns');
const OUTPUT = path.join(ROOT, 'release');
const ELECTRON_VERSION = require('electron/package.json').version;
const ARCHES = ['arm64', 'x64'];

const SOURCE_APP = 'Electron.app/';
const TARGET_APP = 'Quad.app/';
const RESOURCES = 'Contents/Resources/';

const FILE_TYPE_MASK = 0o170000;
const SYMLINK = 0o120000;

const INSTRUCTIONS = `Как запустить Quad на Mac

Сборка без подписи Apple, поэтому macOS сама её не откроет.

1. Перетащи Quad.app в папку «Программы».
2. Открой Терминал и выполни две команды:

xattr -cr /Applications/Quad.app
codesign --force --deep --sign - /Applications/Quad.app

3. Запусти Quad как обычно.
`;

function setPlistValue(plist, key, value) {
  const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  if (pattern.test(plist)) return plist.replace(pattern, `$1${value}$2`);
  return plist.replace('</dict>\n</plist>', `\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>\n</plist>`);
}

function brandPlist(text) {
  const values = {
    CFBundleName: 'Quad',
    CFBundleDisplayName: 'Quad',
    CFBundleIdentifier: 'com.quad.player',
    CFBundleShortVersionString: pkg.version,
    CFBundleVersion: pkg.version,
    LSApplicationCategoryType: 'public.app-category.music',
  };
  return Object.entries(values).reduce((plist, [key, value]) => setPlistValue(plist, key, value), text);
}

const openZip = (file) => new Promise((resolve, reject) => {
  yauzl.open(file, { lazyEntries: true, autoClose: true }, (error, zip) => (error ? reject(error) : resolve(zip)));
});

const readEntry = (zip, entry) => new Promise((resolve, reject) => {
  zip.openReadStream(entry, (error, stream) => {
    if (error) {
      reject(error);
      return;
    }
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
});

async function convert(source, target) {
  const zip = await openZip(source);
  const output = new yazl.ZipFile();
  const written = new Promise((resolve, reject) => {
    output.outputStream.pipe(fs.createWriteStream(target)).on('close', resolve).on('error', reject);
  });

  const replaced = new Map([
    [`${SOURCE_APP}${RESOURCES}electron.icns`, fs.readFileSync(ICON)],
  ]);
  const dropped = new Set([`${SOURCE_APP}${RESOURCES}default_app.asar`]);

  await new Promise((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.on('entry', (entry) => {
      const handle = async () => {
        const { fileName } = entry;
        if (!fileName.startsWith(SOURCE_APP) || dropped.has(fileName)) return;

        const name = TARGET_APP + fileName.slice(SOURCE_APP.length);
        const mode = entry.externalFileAttributes >>> 16;
        const mtime = entry.getLastModDate();

        if (fileName.endsWith('/')) {
          output.addEmptyDirectory(name, { mode: mode || 0o40755, mtime });
          return;
        }

        let data = await readEntry(zip, entry);
        if (fileName === `${SOURCE_APP}Contents/Info.plist`) data = Buffer.from(brandPlist(data.toString('utf8')));
        if (replaced.has(fileName)) data = replaced.get(fileName);

        // Ссылки хранятся как файл с адресом, сжимать их нельзя: тип задаётся режимом.
        const isLink = (mode & FILE_TYPE_MASK) === SYMLINK;
        output.addBuffer(data, name, { mode: mode || 0o100644, mtime, compress: !isLink });
      };
      handle().then(() => zip.readEntry(), reject);
    });
    zip.readEntry();
  });

  output.addBuffer(fs.readFileSync(ASAR), `${TARGET_APP}${RESOURCES}app.asar`, { mode: 0o100644 });
  output.addBuffer(Buffer.from(INSTRUCTIONS), 'Как запустить.txt', { mode: 0o100644 });
  output.end();
  await written;
}

async function main() {
  if (!fs.existsSync(ASAR)) throw new Error('Сначала выполни npm run package');
  fs.mkdirSync(OUTPUT, { recursive: true });

  for (const arch of ARCHES) {
    const source = await downloadArtifact({
      version: ELECTRON_VERSION,
      platform: 'darwin',
      arch,
      artifactName: 'electron',
    });
    const target = path.join(OUTPUT, `Quad-${pkg.version}-mac-${arch}.zip`);
    await convert(source, target);
    console.log(`${path.basename(target)}: ${Math.round(fs.statSync(target).size / 1048576)} МБ`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
