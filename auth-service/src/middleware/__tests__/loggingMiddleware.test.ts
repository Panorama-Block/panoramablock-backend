import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeForLogging } from '../loggingMiddleware';

test('redacts credential-bearing fields recursively', () => {
  const input = {
    address: '0x1234',
    token: 'jwt-secret-value',
    sessionId: 'session-secret-value',
    signature: '0xsignature',
    nested: {
      access_token: 'access-secret',
      refresh_token: 'refresh-secret',
      password: 'password-secret',
      private_key: 'private-key-secret',
      safe: 'visible',
    },
    array: [
      {
        secret: 'nested-secret',
        value: 'visible-array-value',
      },
    ],
  };

  const sanitized = sanitizeForLogging(input) as any;

  assert.equal(sanitized.address, '0x1234');
  assert.equal(sanitized.token, '[REDACTED]');
  assert.equal(sanitized.sessionId, '[REDACTED]');
  assert.equal(sanitized.signature, '[REDACTED]');

  assert.equal(sanitized.nested.access_token, '[REDACTED]');
  assert.equal(sanitized.nested.refresh_token, '[REDACTED]');
  assert.equal(sanitized.nested.password, '[REDACTED]');
  assert.equal(sanitized.nested.private_key, '[REDACTED]');
  assert.equal(sanitized.nested.safe, 'visible');

  assert.equal(sanitized.array[0].secret, '[REDACTED]');
  assert.equal(sanitized.array[0].value, 'visible-array-value');
});

test('redacts cookie and authorization fields', () => {
  const sanitized = sanitizeForLogging({
    authorization: 'Bearer abc',
    cookie: 'panorama_refresh=secret',
    'set-cookie': 'panorama_refresh=secret',
  }) as any;

  assert.equal(sanitized.authorization, '[REDACTED]');
  assert.equal(sanitized.cookie, '[REDACTED]');
  assert.equal(sanitized['set-cookie'], '[REDACTED]');
});

test('redacts suffix-based credential field names', () => {
  const sanitized = sanitizeForLogging({
    api_token: 'secret',
    signing_secret: 'secret',
    database_password: 'secret',
    wallet_private_key: 'secret',
    wallet_signature: 'secret',
    refresh_session_id: 'secret',
  }) as any;

  assert.equal(sanitized.api_token, '[REDACTED]');
  assert.equal(sanitized.signing_secret, '[REDACTED]');
  assert.equal(sanitized.database_password, '[REDACTED]');
  assert.equal(sanitized.wallet_private_key, '[REDACTED]');
  assert.equal(sanitized.wallet_signature, '[REDACTED]');
  assert.equal(sanitized.refresh_session_id, '[REDACTED]');
});

test('does not mutate the original object', () => {
  const input = {
    token: 'original-token',
    nested: {
      safe: 'original-value',
    },
  };

  const sanitized = sanitizeForLogging(input) as any;

  assert.equal(input.token, 'original-token');
  assert.equal(input.nested.safe, 'original-value');

  assert.equal(sanitized.token, '[REDACTED]');
  assert.equal(sanitized.nested.safe, 'original-value');
});
