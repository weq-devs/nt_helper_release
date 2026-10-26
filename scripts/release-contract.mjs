export const PLATFORMS = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
};
export const helperAsset = (platform) =>
  `weq-authorization-helper-${platform}${platform.startsWith('win32-') ? '.exe' : ''}`;

/** 只核对二进制自报的有效期关系，不在发布仓重复定义有效期。 */
export function validateBuildInfo(info, timestamp, target, now = Date.now() / 1000) {
  if (
    info?.isDev !== false ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    info.buildTime !== timestamp ||
    !Number.isSafeInteger(info.validitySecs) ||
    info.validitySecs <= 0 ||
    !Number.isSafeInteger(info.expireTime) ||
    info.expireTime - timestamp !== info.validitySecs ||
    info.expireTime <= now ||
    (target &&
      (info.target !== target ||
        info.protocol !== 1 ||
        !['attach', 'key-scan', 'capture'].every((name) => info.capabilities?.includes(name))))
  )
    throw new Error('原生构建的目标、协议或有效性信息不符合发布契约');
}
