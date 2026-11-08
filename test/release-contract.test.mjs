import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateBuildInfo } from '../scripts/release-contract.mjs';

const timestamp = 1700000000;
const info = {
  target: 'x86_64-unknown-linux-gnu',
  protocol: 2,
  capabilities: ['attach', 'key-scan', 'capture'],
  buildTime: timestamp,
  expireTime: timestamp + 12345,
  validitySecs: 12345,
  isDev: false,
};

test('握手协议版本由私有源码定义，发布仓只要求为正整数', () => {
  assert.doesNotThrow(() => validateBuildInfo(info, timestamp, info.target, timestamp + 1));
  assert.doesNotThrow(() =>
    validateBuildInfo({ ...info, protocol: 1 }, timestamp, info.target, timestamp + 1),
  );
});

test('拒绝非法握手协议版本', () => {
  for (const protocol of [0, -1, 1.5, '2', undefined, null]) {
    assert.throws(() =>
      validateBuildInfo({ ...info, protocol }, timestamp, info.target, timestamp + 1),
    );
  }
});
