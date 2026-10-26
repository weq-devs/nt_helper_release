import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLATFORMS, helperAsset } from '../scripts/release-contract.mjs';
import { stageManifest } from '../scripts/stage-manifest.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'native-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const timestamp = 1700000000;
  const addonInfo = {
    buildTime: timestamp,
    expireTime: timestamp + 12345,
    validitySecs: 12345,
    isDev: false,
  };
  for (const [platform, target] of Object.entries(PLATFORMS)) {
    const bytes = Buffer.from(`synthetic-${platform}`);
    await writeFile(join(directory, `nt_helper-${platform}.node`), bytes);
    const asset = helperAsset(platform);
    await writeFile(join(directory, asset), bytes);
    await writeFile(
      join(directory, `authorization-${platform}.json`),
      JSON.stringify({
        authorization: {
          [platform]: {
            asset,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            size: bytes.length,
            ...addonInfo,
            target,
            protocol: 1,
            capabilities: ['attach', 'key-scan', 'capture'],
            privateExtra: 'must not publish',
          },
        },
      }),
    );
  }
  for (const part of ['bubble', 'widget', 'font'])
    await writeFile(join(directory, `dress-${part}.dat`), 'synthetic');
  return {
    directory,
    tag: 'nt-helper-fixture',
    commit: 'a'.repeat(40),
    timestamp,
    now: timestamp + 1,
    addonInfo,
    runId: 'fixture',
  };
}

test('五平台同源资产合并，摘要覆盖最终资产且不透传任意字段', async (t) => {
  const options = await fixture(t);
  const manifest = await stageManifest(options);
  assert.equal(Object.keys(manifest.authorization).length, Object.keys(PLATFORMS).length);
  assert.equal(JSON.stringify(manifest).includes('privateExtra'), false);
  const sums = await readFile(join(options.directory, 'SHA256SUMS'), 'utf8');
  assert.equal(sums.trim().split('\n').length, 14);
  assert.equal(sums.includes('authorization-'), true);
  assert.equal(sums.includes('.json\n'), true);
  assert.equal(sums.includes('authorization-win32-x64.json'), false);
});
for (const scenario of [
  'missing',
  'tampered',
  'wrong-target',
  'dev',
  'timestamp',
  'expired',
  'private-file',
  'symlink',
])
  test(`不发布不完整、不同源或越界资产：${scenario}`, async (t) => {
    const options = await fixture(t);
    const helper = join(options.directory, helperAsset('linux-arm64'));
    const fragment = join(options.directory, 'authorization-linux-arm64.json');
    if (scenario === 'expired') options.now = options.addonInfo.expireTime + 1;
    if (scenario === 'missing') await rm(helper);
    if (scenario === 'tampered') await writeFile(helper, 'changed');
    if (scenario === 'private-file')
      await writeFile(join(options.directory, 'private-source.rs'), 'synthetic');
    if (scenario === 'symlink') {
      await rm(helper);
      await symlink(join(options.directory, 'nt_helper-linux-arm64.node'), helper);
    }
    if (['wrong-target', 'dev', 'timestamp'].includes(scenario)) {
      const value = JSON.parse(await readFile(fragment, 'utf8'));
      const info = value.authorization['linux-arm64'];
      if (scenario === 'wrong-target') info.target = PLATFORMS['linux-x64'];
      if (scenario === 'dev') info.isDev = true;
      if (scenario === 'timestamp') info.buildTime++;
      await writeFile(fragment, JSON.stringify(value));
    }
    await assert.rejects(stageManifest(options));
    await assert.rejects(readFile(join(options.directory, 'manifest.json')));
  });
