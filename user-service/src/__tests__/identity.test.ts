import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isIdentityProvider,
  normalizeProviderSubject,
} from '../domain/identity';

test('accepts only explicitly supported identity providers', () => {
  assert.equal(isIdentityProvider('thirdweb-evm'), true);
  assert.equal(isIdentityProvider('telegram'), true);
  assert.equal(isIdentityProvider('ton'), true);
  assert.equal(isIdentityProvider('unknown'), false);
  assert.equal(isIdentityProvider(''), false);
});

test('normalizes Thirdweb EVM subjects to lowercase', () => {
  assert.equal(
    normalizeProviderSubject(
      'thirdweb-evm',
      '  0xAbCdEfABCDEFabcdefABCDEFabcdefABCDEFabcd  '
    ),
    '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
  );
});

test('does not reinterpret Telegram subjects', () => {
  assert.equal(
    normalizeProviderSubject('telegram', ' 123456789 '),
    '123456789'
  );
});

test('does not reinterpret TON subjects', () => {
  assert.equal(
    normalizeProviderSubject('ton', ' EQExampleAddress '),
    'EQExampleAddress'
  );
});

test('rejects an empty provider subject', () => {
  assert.throws(
    () => normalizeProviderSubject('telegram', '   '),
    /must not be empty/
  );
});
