import { createDecipheriv, createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const parts = ['bubble', 'font', 'widget'];
const names = [
  'config.json',
  'static.zip',
  'other.zip',
  'aio_50.png',
  'xydata.js',
  'main',
  'fzfont',
];

function firstRecord(raw) {
  if (raw.length < 4) throw new Error('Empty dress record stream');
  const end = 4 + raw.readUInt32BE();
  if (end > raw.length) throw new Error('Truncated dress record');
  let offset = 4;
  const varint = () => {
    let value = 0n;
    for (let shift = 0n; shift < 70n && offset < end; shift += 7n) {
      const byte = raw[offset++];
      value |= BigInt(byte & 127) << shift;
      if (byte < 128) {
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Oversized varint');
        return Number(value);
      }
    }
    throw new Error('Invalid dress varint');
  };
  const fields = {};
  while (offset < end) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    switch (tag % 8) {
      case 0:
        fields[field] = varint();
        break;
      case 2: {
        const length = varint();
        if (offset + length > end) throw new Error('Truncated dress field');
        fields[field] = raw.toString('utf8', offset, offset + length);
        offset += length;
        break;
      }
      case 1:
        offset += 8;
        break;
      case 5:
        offset += 4;
        break;
      default:
        throw new Error('Invalid dress wire type');
    }
    if (offset > end) throw new Error('Truncated dress field');
  }
  const host = [
    ['/qqcontent/', 'https://showv6.gtimg.cn'],
    ['/club/', 'https://iv6.gtimg.cn'],
    ['/zip/', 'https://gxh.material.qq.com'],
  ].find(([prefix]) => typeof fields[3] === 'string' && fields[3].startsWith(prefix))?.[1];
  if (
    !Number.isInteger(fields[1]) ||
    fields[1] < 1 ||
    !names.includes(fields[2]) ||
    !host ||
    !Number.isInteger(fields[4]) ||
    fields[4] < 0
  )
    throw new Error('Invalid dress probe record');
  return { itemId: String(fields[1]), name: fields[2], url: host + fields[3], size: fields[4] };
}

export async function verifyDress(directory, commit, addon) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Expected full source commit');
  const expected = ['dress-build.json', ...parts.map((part) => `${part}.dat`)].sort();
  const actual = (await readdir(directory)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('Unexpected dress artifact files');
  for (const name of expected) {
    if (!(await lstat(resolve(directory, name))).isFile())
      throw new Error('Dress artifact must contain regular files');
  }
  const manifest = JSON.parse(await readFile(resolve(directory, 'dress-build.json'), 'utf8'));
  if (
    manifest.commit !== commit ||
    manifest.format !== 1 ||
    JSON.stringify(Object.keys(manifest.files ?? {}).sort()) !== JSON.stringify(parts)
  )
    throw new Error('Dress artifact source or format mismatch');
  const key = createHash('sha256').update(`nt_helper-dress-v1:${commit}`).digest();
  for (const part of parts) {
    const bytes = await readFile(resolve(directory, `${part}.dat`));
    const metadata = manifest.files[part];
    if (
      metadata?.size !== bytes.length ||
      metadata.sha256 !== createHash('sha256').update(bytes).digest('hex') ||
      bytes.length < 37 ||
      !bytes.subarray(0, 5).equals(Buffer.from('NTDR\x01')) ||
      (bytes.length - 21) % 16 !== 0
    )
      throw new Error('Dress artifact checksum or header mismatch');
    const cipher = createDecipheriv('aes-256-cbc', key, bytes.subarray(5, 21));
    const plain = Buffer.concat([cipher.update(bytes.subarray(21)), cipher.final()]);
    const probe = firstRecord(brotliDecompressSync(plain, { maxOutputLength: 512 * 1024 * 1024 }));
    if (addon) {
      const result = addon.queryDressResourceUrl(part, probe.itemId, probe.name);
      if (result?.url !== probe.url || result.size !== probe.size)
        throw new Error('Addon cannot read shared dress artifacts');
    }
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [directory, commit, addonPath] = process.argv.slice(2);
    // Must be set before the addon performs its first cached dress query.
    process.env.NT_HELPER_DRESS_DIR = resolve(directory);
    const addon = addonPath ? createRequire(import.meta.url)(resolve(addonPath)) : undefined;
    await verifyDress(directory, commit, addon);
    console.log('Verified shared encrypted dress artifacts and source compatibility');
  } catch {
    console.error(
      '::error::Shared dress verification failed; private diagnostics are not published.',
    );
    process.exitCode = 1;
  }
}
