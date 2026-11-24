import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AppError, codeForDbError, codeOf, describeError, ERROR_CODES, withCode } from '../../src/lib/error-codes';

const doc = readFileSync(fileURLToPath(new URL('../../docs/error-codes.md', import.meta.url)), 'utf8');
/** 表の1列目にあるコード（「起きたことの記録」は2列目なので含めない） */
const docCodes = [...doc.matchAll(/^\| (IJ-[A-Z]+-\d{3}) \|/gm)].map((m) => m[1]);

describe('エラーコード表', () => {
  it('アプリのコードと docs/error-codes.md の表がそろっている', () => {
    expect([...docCodes].sort()).toEqual(Object.keys(ERROR_CODES).sort());
  });

  it('表に同じコードが2回ない', () => {
    expect(new Set(docCodes).size).toBe(docCodes.length);
  });

  it('コードの形は IJ-分類-3桁', () => {
    for (const code of Object.keys(ERROR_CODES)) expect(code).toMatch(/^IJ-[A-Z]+-\d{3}$/);
  });
});

describe('codeForDbError', () => {
  it.each([
    [{ code: '42501', message: 'new row violates row-level security policy' }, 'IJ-DB-001'],
    [{ code: '23505', message: 'duplicate key' }, 'IJ-DB-002'],
    [{ code: '23514', message: 'check constraint' }, 'IJ-DB-003'],
    [{ code: '22P02', message: 'invalid input syntax' }, 'IJ-DB-003'],
    [{ code: 'PGRST116', message: 'no rows' }, 'IJ-DB-004'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 'IJ-AUTH-001'],
    [{ code: '', message: 'TypeError: Network request failed' }, 'IJ-NET-001'],
    [{ code: 'XX000', message: 'internal' }, 'IJ-DB-009'],
  ] as const)('%o → %s', (err, code) => {
    expect(codeForDbError(err)).toBe(code);
  });
});

describe('codeOf・describeError', () => {
  it('AppError はそのコード', () => {
    expect(codeOf(new AppError('IJ-BIL-003'))).toBe('IJ-BIL-003');
  });

  it('通信のエラーは文から推し量る', () => {
    expect(codeOf(new TypeError('Network request failed'))).toBe('IJ-NET-001');
  });

  it('分からなければ fallback', () => {
    expect(codeOf(new Error('???'), 'IJ-DB-009')).toBe('IJ-DB-009');
    expect(codeOf('???')).toBe('IJ-UNK-000');
  });

  it('本文に元の文とエラーコードを付ける', () => {
    const text = describeError(new AppError('IJ-BIL-004', '途中で終わりました。', 'ストア：user-cancelled／ストアの国・地域：USA'));
    expect(text).toContain('途中で終わりました。');
    expect(text).toContain('ストアの国・地域：USA');
    expect(text).toContain('エラーコード：IJ-BIL-004');
  });

  it('withCode は案内の文にコードを付ける', () => {
    expect(withCode('許可してください。', 'IJ-PERM-001')).toBe('許可してください。\n\nエラーコード：IJ-PERM-001');
  });
});
