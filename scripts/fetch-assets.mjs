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
    let lastReportedBytes = 0;
    let lastReportedAt = Date.now();
    let lastReportedPercent = -5;
    const formatMegabytes = bytes => (bytes / 1024 / 1024).toFixed(1);
    const reportProgress = force => {
      const now = Date.now();
      const percent = total ? Math.min(100, Math.floor(received / total * 100)) : null;
      if (!force && (
        (percent !== null && percent < lastReportedPercent + 5)
        || (percent === null && now - lastReportedAt < 3000)
      )) return;
      const elapsedSeconds = Math.max((now - lastReportedAt) / 1000, 0.001);
      const megabytesPerSecond = (received - lastReportedBytes) / 1024 / 1024 / elapsedSeconds;
      const amount = total
        ? `${percent}% · ${formatMegabytes(received)} / ${formatMegabytes(total)} MB`
        : `${formatMegabytes(received)} MB`;
      console.log(`Downloading ${amount} · ${megabytesPerSecond.toFixed(1)} MB/s`);
      lastReportedBytes = received;
      lastReportedAt = now;
      if (percent !== null) lastReportedPercent = percent;
    };
    response.on('data', chunk => {
      received += chunk.length;
      reportProgress(false);
    });
    const progressTimer = setInterval(() => reportProgress(true), 3000);
    pipeline(response, createWriteStream(target)).then(() => {
      clearInterval(progressTimer);
      if (!total || lastReportedPercent < 100) reportProgress(true);
      resolveDownload();
    }, error => {
      clearInterval(progressTimer);
      reject(error);
    });
  });
  request.on('error', reject);
  request.setTimeout(30000, () => request.destroy(new Error('Download stalled for 30 seconds')));
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
  console.log('Verifying SHA-256…');
  const actual = await digest(temporary);
  if (actual !== asset.sha256) throw new Error(`Checksum mismatch: expected ${asset.sha256}, received ${actual}`);
  await rename(temporary, asset.path);
  console.log(`Saved ${asset.path}`);
} catch (error) {
  await rm(temporary, { force: true });
  throw error;
}
