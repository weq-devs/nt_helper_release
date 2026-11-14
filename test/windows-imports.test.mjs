import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { checkWindowsImports } from '../scripts/check-windows-imports.mjs';

test('helper accepts system DLLs, addon may use the host CRT', () => {
  assert.doesNotThrow(() => checkWindowsImports('KERNEL32.dll\nole32.dll\nSHELL32.dll', true));
  assert.doesNotThrow(() => checkWindowsImports('KERNEL32.dll\nVCRUNTIME140.dll'));
});

test('both binaries reject old enclave synchronization imports', () => {
  for (const helper of [false, true])
    for (const name of ['vertdll.dll', 'VERTDLL.DLL'])
      assert.throws(() => checkWindowsImports(`KERNEL32.dll\n${name}`, helper), /vertdll/);
  assert.throws(() => checkWindowsImports('KERNEL32.dll\nVCRUNTIME140.dll', true));
  assert.throws(() => checkWindowsImports(''));
});

test('release inspects actual addon and helper imports before upload', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /nt_helper-win32-x64\.node/);
  assert.match(workflow, /check-windows-imports\.mjs helper/);
  assert.match(workflow, /check-windows-imports\.mjs addon/);
});
