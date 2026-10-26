import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PLATFORMS, helperAsset, validateBuildInfo } from './release-contract.mjs';

const [directory, platform, rawTimestamp] = process.argv.slice(2);
try {
  const target = PLATFORMS[platform];
  if (!target || `${process.platform}-${process.arch}` !== platform)
    throw new Error('发布验证必须在匹配目标的原生 runner 上运行');
  const timestamp = Number(rawTimestamp);
  const helper = resolve(directory, helperAsset(platform));
  const info = JSON.parse(
    execFileSync(helper, ['build-info'], { encoding: 'utf8', timeout: 5000, maxBuffer: 16384 }),
  );
  validateBuildInfo(info, timestamp, target);
  const fragment = JSON.parse(
    await readFile(resolve(directory, `authorization-${platform}.json`), 'utf8'),
  );
  const metadata = fragment.authorization?.[platform];
  for (const key of ['protocol', 'target', 'buildTime', 'expireTime', 'validitySecs', 'isDev'])
    if (metadata?.[key] !== info[key]) throw new Error('助手清单与真实产物不一致');
  const addon = createRequire(import.meta.url)(resolve(directory, `nt_helper-${platform}.node`));
  const addonInfo = addon.getBuildInfo();
  validateBuildInfo(addonInfo, timestamp);
  if (addonInfo.expireTime !== info.expireTime || addon.getInitStatus() !== 0)
    throw new Error('普通原生模块与助手不一致或不可用');
  console.log(`已验证 ${platform} 的两个原生产物，仅查询构建信息，未安装服务或访问 QQ`);
} catch {
  // 公开 runner 不输出原生异常栈、私有源码片段或诊断日志。
  console.error('::error::原生产物冒烟失败；检查目标、同源时间戳与运行依赖，不发布本次构建。');
  process.exitCode = 1;
}
