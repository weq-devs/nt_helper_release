import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { verifyDress } from '../scripts/verify-dress.mjs';

const commit = 'a'.repeat(40);
const parts = ['bubble', 'font', 'widget'];
const url = 'https://showv6.gtimg.cn/qqcontent/synthetic';

async function fixture(t, keyCommit = commit, header = Buffer.from('NTDR\x01')) {
  const directory = await mkdtemp(join(tmpdir(), 'dress-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Independently encoded legacy protobuf fields: item_id, part, path, size.
  const field = (tag, text) =>
    Buffer.concat([Buffer.from([tag, Buffer.byteLength(text)]), Buffer.from(text)]);
  const record = Buffer.concat([
    Buffer.from([8, 42]),
    field(18, 'main'),
    field(26, '/qqcontent/synthetic'),
    Buffer.from([32, 99]),
  ]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(record.length);
  const plain = brotliCompressSync(Buffer.concat([size, record]));
  const key = createHash('sha256').update(`nt_helper-dress-v1:${keyCommit}`).digest();
  const files = {};
  for (const part of parts) {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const bytes = Buffer.concat([header, iv, cipher.update(plain), cipher.final()]);
    await writeFile(join(directory, `${part}.dat`), bytes);
    files[part] = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  await writeFile(
    join(directory, 'dress-build.json'),
    JSON.stringify({ commit, format: 1, files }),
  );
  return directory;
}

test('同一套加密索引校验并逐类通过真实 addon 查询契约', async (t) => {
  const directory = await fixture(t);
  const calls = [];
  await verifyDress(directory, commit, {
    queryDressResourceUrl(...args) {
      calls.push(args);
      return { url, size: 99 };
    },
  });
  assert.deepEqual(
    calls,
    parts.map((part) => [part, '42', 'main']),
  );
});

for (const scenario of [
  'wrong-commit',
  'wrong-key',
  'tampered',
  'wrong-format',
  'missing',
  'extra-file',
  'symlink',
  'addon-miss',
  'addon-wrong-url',
  'addon-wrong-size',
]) {
  test(`拒绝不同源、不完整或无法读取的共享索引：${scenario}`, async (t) => {
    const directory = await fixture(
      t,
      scenario === 'wrong-key' ? 'b'.repeat(40) : commit,
      scenario === 'wrong-format' ? Buffer.from('NTDR\x02') : undefined,
    );
    if (scenario === 'tampered') await writeFile(join(directory, 'font.dat'), 'changed');
    if (scenario === 'missing') await rm(join(directory, 'font.dat'));
    if (scenario === 'extra-file')
      await writeFile(join(directory, 'private-source.rs'), 'synthetic');
    if (scenario === 'symlink') {
      await rm(join(directory, 'font.dat'));
      await symlink(join(directory, 'bubble.dat'), join(directory, 'font.dat'));
    }
    const addon = scenario.startsWith('addon-')
      ? {
          queryDressResourceUrl() {
            if (scenario === 'addon-miss') return null;
            return {
              url: scenario === 'addon-wrong-url' ? 'wrong' : url,
              size: scenario === 'addon-wrong-size' ? 100 : 99,
            };
          },
        }
      : undefined;
    await assert.rejects(
      verifyDress(directory, scenario === 'wrong-commit' ? 'b'.repeat(40) : commit, addon),
    );
  });
}

test('发布任务只加工一次，所有平台禁用加工并校验同一 artifact', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8',
  );
  assert.equal(
    (workflow.match(/cargo run --locked --release -p nt-helper-dress-pack/g) ?? []).length,
    1,
  );
  assert.match(workflow, /needs: \[prepare, dress\]/);
  assert.match(workflow, /NT_HELPER_PACK_DRESS: '0'/);
  assert.match(workflow, /artifact-ids: \$\{\{ needs\.dress\.outputs\.artifact_id \}\}/);
  assert.match(
    workflow,
    /verify-dress\.mjs \.dress-shared "\$SOURCE_SHA" "out\/\$\{\{ matrix\.asset \}\}\.node"/,
  );
  assert.match(workflow, /cmp "\.dress-shared\/\$part\.dat" "dist\/dress-\$part\.dat"/);
  assert.match(workflow, /retention-days: 1/);
});
