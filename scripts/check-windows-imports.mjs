import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkWindowsImports(report, helper = false) {
  if (typeof report !== 'string' || !/\b[\w.-]+\.dll\b/i.test(report))
    throw new Error('Missing Windows import inspection');
  if (/\bvertdll\.dll\b/i.test(report))
    throw new Error('Windows synchronization must not import enclave-only vertdll.dll');
  if (helper && /(VCRUNTIME|MSVCP|libssl|libcrypto|sqlite|node\.dll|electron)/i.test(report))
    throw new Error('Helper contains an unexpected runtime dependency');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  checkWindowsImports(readFileSync(0, 'utf8'), process.argv[2] === 'helper');
  console.log('Windows import contract verified');
}
