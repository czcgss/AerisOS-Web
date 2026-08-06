import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { get } from 'node:https';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const asset = {
  name: 'Alpine Linux 3.24.1 x86 standard image',
  url: 'https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/x86/alpine-standard-3.24.1-x86.iso',
  path: resolve(root, 'public/v86/alpine.iso'),
  sha256: '525914e7d34380adaedeee2c8a4bc09b25b8f9cc50f073af10fef6a176f8729a',
};

const digest = path => new Promise((resolveHash, reject) => {
  const hash = createHash('sha256');
  const input = createReadStream(path);
  input.on('error', reject);
  input.on('data', chunk => hash.update(chunk));
  input.on('end', () => resolveHash(hash.digest('hex')));
});

const isValid = async () => {
  try {
    const info = await stat(asset.path);
    return info.isFile() && await digest(asset.path) === asset.sha256;
  } catch {
    return false;
  }
};

const download = (url, target, redirects = 5) => new Promise((resolveDownload, reject) => {
  const request = get(url, response => {
    const location = response.headers.location;
    if (location && response.statusCode >= 300 && response.statusCode < 400 && redirects > 0) {
      response.resume();
      download(new URL(location, url), target, redirects - 1).then(resolveDownload, reject);
      return;
    }
    if (response.statusCode !== 200) {
      response.resume();
      reject(new Error(`Download failed with HTTP ${response.statusCode}`));
      return;
    }
    const total = Number(response.headers['content-length']) || 0;
    let received = 0;
    response.on('data', chunk => {
      received += chunk.length;
      if (total && received % (8 * 1024 * 1024) < chunk.length) {
        process.stdout.write(`\rDownloading ${Math.floor(received / total * 100)}%`);
      }
    });
    pipeline(response, createWriteStream(target)).then(resolveDownload, reject);
  });
  request.on('error', reject);
});

if (await isValid()) {
  console.log(`${asset.name} is ready.`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  console.error(`Missing or invalid runtime asset: ${asset.path}\nRun \`pnpm assets\` first.`);
  process.exit(1);
}

await mkdir(dirname(asset.path), { recursive: true });
const temporary = `${asset.path}.part`;
await rm(temporary, { force: true });
console.log(`Fetching ${asset.name}…`);
try {
  await download(asset.url, temporary);
  process.stdout.write('\nVerifying SHA-256…\n');
  const actual = await digest(temporary);
  if (actual !== asset.sha256) throw new Error(`Checksum mismatch: expected ${asset.sha256}, received ${actual}`);
  await rename(temporary, asset.path);
  console.log(`Saved ${asset.path}`);
} catch (error) {
  await rm(temporary, { force: true });
  throw error;
}
