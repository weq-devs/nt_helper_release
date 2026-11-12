import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { cleanupDraftRelease } from '../scripts/cleanup-draft.mjs';

const options = { repository: 'fixture/native', tag: 'nt-helper-fixture', log: () => {} };
const missing = () => Object.assign(new Error('release not found'), { status: 1 });

function fixture(states, deleteError) {
  const calls = [];
  return {
    calls,
    run(_command, args) {
      calls.push(args);
      if (args[1] === 'view') {
        const state = states.shift();
        if (state instanceof Error) throw state;
        return JSON.stringify({ isDraft: state });
      }
      if (deleteError) throw deleteError;
      return '';
    },
  };
}

test('公开成功而 latest.json 推送失败时保留正式 Release', async () => {
  const f = fixture([false]);
  assert.equal(await cleanupDraftRelease({ ...options, run: f.run }), 'published');
  assert.equal(f.calls.length, 1);
});

test('只删除实际仍为草稿的 Release，不删除 Git 标签', async () => {
  const f = fixture([true, missing()]);
  assert.equal(await cleanupDraftRelease({ ...options, run: f.run }), 'deleted');
  const deletion = f.calls.find((args) => args[1] === 'delete');
  assert.ok(deletion);
  assert.ok(!deletion.includes('--cleanup-tag'));
});

test('Release 已不存在时不再删除', async () => {
  const f = fixture([missing()]);
  assert.equal(await cleanupDraftRelease({ ...options, run: f.run }), 'missing');
  assert.equal(f.calls.length, 1);
});

test('查询失败或状态不合法时停止清理，不猜测为草稿', async () => {
  for (const state of [new Error('HTTP 503'), undefined, 'true', null]) {
    const f = fixture([state]);
    await assert.rejects(cleanupDraftRelease({ ...options, run: f.run }));
    assert.equal(f.calls.length, 1);
  }
});

test('删除请求失败但 Release 已转正时不重试删除', async () => {
  const f = fixture([true, false], new Error('network timeout'));
  assert.equal(await cleanupDraftRelease({ ...options, run: f.run }), 'published');
  assert.equal(f.calls.filter((args) => args[1] === 'delete').length, 1);
});

test('删除失败且仍是草稿时明确报错', async () => {
  const f = fixture([true, true], new Error('network timeout'));
  await assert.rejects(cleanupDraftRelease({ ...options, run: f.run }), /未能删除/);
});

test('失败清理工作流调用有实时状态检查的入口，不直接删除 Release', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const cleanup = workflow.slice(workflow.indexOf('  cleanup-draft:'));
  assert.match(cleanup, /run: node scripts\/cleanup-draft\.mjs/);
  assert.doesNotMatch(cleanup, /gh release delete/);
});
