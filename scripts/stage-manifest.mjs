import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORMS, helperAsset, validateBuildInfo } from './release-contract.mjs';

async function metadata(directory, asset) {
  const file = join(directory, asset);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`非法或空资产：${asset}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { asset, sha256: hash.digest('hex'), size: stat.size };
}

export async function stageManifest({ directory, tag, commit, timestamp, addonInfo, runId, now }) {
  if (!/^nt-helper-[\w.-]+$/.test(tag ?? '') || !/^[a-f0-9]{40}$/.test(commit ?? ''))
    throw new Error('发布身份不合法');
  validateBuildInfo(addonInfo, timestamp, undefined, now);
  const platforms = {},
    authorization = {},
    dress = {};
  const checksums = new Map();
  const allowed = new Set(['manifest.json', 'SHA256SUMS']);
  const add = async (asset) => {
    allowed.add(asset);
    const result = await metadata(directory, asset);
    checksums.set(asset, result.sha256);
    return result;
  };
  for (const [platform, target] of Object.entries(PLATFORMS)) {
    platforms[platform] = await add(`nt_helper-${platform}.node`);
    const fragment = `authorization-${platform}.json`;
    allowed.add(fragment);
    const info = await lstat(join(directory, fragment));
    if (!info.isFile() || info.size > 16384) throw new Error('非法助手清单片段');
    const parsed = JSON.parse(await readFile(join(directory, fragment), 'utf8'));
    if (Object.keys(parsed.authorization ?? {}).join() !== platform)
      throw new Error('助手片段的平台数量不正确');
    const claimed = parsed.authorization[platform];
    validateBuildInfo(claimed, timestamp, target, now);
    if (claimed.expireTime !== addonInfo.expireTime) throw new Error('两个原生产物的有效期不一致');
    const actual = await add(helperAsset(platform));
    if (
      claimed.asset !== actual.asset ||
      claimed.sha256 !== actual.sha256 ||
      claimed.size !== actual.size ||
      actual.size > 64 * 1024 * 1024
    )
      throw new Error(`助手资产校验失败：${platform}`);
    // 只输出已知公开字段，不将任意片段字段透传到公开 manifest。
    authorization[platform] = {
      ...actual,
      protocol: claimed.protocol,
      target,
      capabilities: ['attach', 'key-scan', 'capture'],
      buildTime: timestamp,
      expireTime: claimed.expireTime,
      validitySecs: claimed.validitySecs,
      isDev: false,
    };
  }
  for (const part of ['bubble', 'widget', 'font']) dress[part] = await add(`dress-${part}.dat`);
  const syncAsset = 'qq-sync-win32-x64.json';
  const sync = JSON.parse(await readFile(join(directory, syncAsset), 'utf8'));
  if (
    sync.protocol !== 1 ||
    !/^[a-f0-9]{16}$/.test(sync.buildId) ||
    Object.keys(sync).sort().join() !== 'buildId,files,protocol'
  )
    throw new Error('QQ 同步组件分发协议不匹配');
  const syncPaths = {
    'runtime.mjs': 'qq-sync-runtime-win32-x64.mjs',
    'generated/windows/QqSync/current.json': 'qq-sync-current.json',
    [`generated/windows/QqSync/${sync.buildId}/WeQ.QqSyncHost.exe`]: 'WeQ.QqSyncHost.exe',
    [`generated/windows/QqSync/${sync.buildId}/WeQ.QqSyncProbe.dll`]: 'WeQ.QqSyncProbe.dll',
  };
  if (
    Object.keys(sync.files ?? {})
      .sort()
      .join() !== Object.keys(syncPaths).sort().join()
  )
    throw new Error('QQ 同步组件文件不在发布白名单');
  const syncFiles = {};
  for (const [path, asset] of Object.entries(syncPaths)) {
    const claimed = sync.files[path];
    const actual = await add(asset);
    if (
      Object.keys(claimed).sort().join() !== 'asset,sha256,size' ||
      claimed.asset !== actual.asset ||
      claimed.sha256 !== actual.sha256 ||
      claimed.size !== actual.size
    )
      throw new Error('QQ 同步组件内容不匹配');
    syncFiles[path] = actual;
  }
  const qqSync = {
    'win32-x64': {
      protocol: 1,
      buildId: sync.buildId,
      files: syncFiles,
      ...(await add(syncAsset)),
    },
  };
  for (const file of await readdir(directory))
    if (!allowed.has(file) || !(await lstat(join(directory, file))).isFile())
      throw new Error(`拒绝发布非白名单文件或链接：${file}`);
  const manifest = {
    tag,
    commit,
    builtAt: new Date().toISOString(),
    buildTime: new Date(timestamp * 1000).toISOString(),
    expiresAt: new Date(addonInfo.expireTime * 1000).toISOString(),
    runId,
    source: `weq-devs/nt_helper@${commit}`,
    dressKeySeed: commit,
    platforms,
    authorization,
    qqSync,
    dress,
  };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  checksums.set('manifest.json', createHash('sha256').update(serialized).digest('hex'));
  // 全量预检通过后才落盘；清单片段是 draft 中转物，不列入最终发布资产。
  await writeFile(join(directory, 'manifest.json'), serialized);
  await writeFile(
    join(directory, 'SHA256SUMS'),
    [...checksums]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, hash]) => `${hash}  ${name}\n`)
      .join(''),
  );
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const directory = resolve(process.argv[2] ?? 'dist');
    const addon = createRequire(import.meta.url)(join(directory, 'nt_helper-linux-x64.node'));
    const manifest = await stageManifest({
      directory,
      tag: process.env.TAG,
      commit: process.env.SOURCE_SHA,
      timestamp: Number(process.env.BUILD_TIMESTAMP),
      addonInfo: addon.getBuildInfo(),
      runId: process.env.GITHUB_RUN_ID,
    });
    console.log(`manifest 已验证：${manifest.tag}，5 组 .node/助手及 3 份装扮资源`);
  } catch {
    console.error('::error::完整资产、同源构建或公开文件白名单校验失败，不发布。');
    process.exitCode = 1;
  }
}
