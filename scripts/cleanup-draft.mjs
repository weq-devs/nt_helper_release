import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 清理只依据 GitHub 的实时状态；publish job 失败并不意味着 Release 仍是草稿。 */
export async function cleanupDraftRelease({ repository, tag, run = execFileSync, log = console.log }) {
  if (!repository || !tag) throw new Error('清理需要明确的仓库和 Release tag');
  const state = () => {
    let response;
    try {
      response = run('gh', ['release', 'view', tag, '--repo', repository, '--json', 'isDraft'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const message = `${error.message ?? ''}\n${String(error.stderr ?? '')}`;
      if (/release not found|\bHTTP 404\b/i.test(message)) return 'missing';
      throw new Error('无法核实 Release 状态，未执行删除', { cause: error });
    }
    const release = JSON.parse(response);
    if (typeof release.isDraft !== 'boolean') throw new Error('Release 草稿状态不合法，未执行删除');
    return release.isDraft ? 'draft' : 'published';
  };
  const initial = state();
  if (initial !== 'draft') {
    log(initial === 'published' ? `保留已公开的 Release ${tag}` : `Release ${tag} 已不存在`);
    return initial;
  }
  let deletionError;
  try {
    // 草稿可能引用已经存在的源码标签，清理资产时不连带删除 Git 标签。
    run('gh', ['release', 'delete', tag, '--repo', repository, '--yes'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    deletionError = error;
  }
  const final = state();
  if (final === 'missing') {
    log(`已删除草稿 ${tag}`);
    return 'deleted';
  }
  if (final === 'published') {
    log(`保留已公开的 Release ${tag}，不重试删除`);
    return 'published';
  }
  throw new Error(`未能删除草稿 ${tag}，请检查发布仓`, { cause: deletionError });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await cleanupDraftRelease({ repository: process.env.RELEASE_REPO, tag: process.env.TAG });
  } catch (error) {
    console.error(`::warning::${error.message}`);
    process.exitCode = 1;
  }
}
