import assert from 'node:assert/strict';
import test from 'node:test';

import { privateKeyToAccount } from 'viem/accounts';
import {
  __authTestUtils,
  generateLoginPayload,
  generateToken,
  validateToken,
  verifySignature,
} from '../thirdwebAuth';

const TEST_PRIVATE_KEY =
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' as const;

const account = privateKeyToAccount(TEST_PRIVATE_KEY);

function withTestEnvironment<T>(
  fn: () => Promise<T>
): Promise<T> {
  const previousKey = process.env.AUTH_PRIVATE_KEY;
  const previousDomain = process.env.AUTH_DOMAIN;

  process.env.AUTH_PRIVATE_KEY = TEST_PRIVATE_KEY;
  process.env.AUTH_DOMAIN = 'panoramablock.com';

  return fn().finally(() => {
    if (previousKey === undefined) {
      delete process.env.AUTH_PRIVATE_KEY;
    } else {
      process.env.AUTH_PRIVATE_KEY = previousKey;
    }

    if (previousDomain === undefined) {
      delete process.env.AUTH_DOMAIN;
    } else {
      process.env.AUTH_DOMAIN = previousDomain;
    }
  });
}

test('generateLoginPayload preserves the Panorama login contract', async () => {
  await withTestEnvironment(async () => {
    const payload = await generateLoginPayload(account.address);

    assert.equal(payload.type, 'evm');
    assert.equal(payload.domain, 'panoramablock.com');
    assert.equal(payload.address, account.address);
    assert.equal(
      payload.statement,
      'Login to Panorama Block platform'
    );
    assert.equal(payload.version, '1');

    assert.ok(payload.nonce);
    assert.ok(payload.issued_at);
    assert.ok(payload.expiration_time);
    assert.ok(payload.invalid_before);

    const issued = Date.parse(payload.issued_at);
    const expiry = Date.parse(payload.expiration_time);

    assert.ok(expiry > issued);
    assert.equal((expiry - issued) / 1000, 600);
  });
});

test('EOA login signature verifies against legacy SIWE-style message', async () => {
  await withTestEnvironment(async () => {
    const payload = await generateLoginPayload(account.address);

    const message =
      __authTestUtils.createLoginMessage(payload);

    const signature = await account.signMessage({
      message,
    });

    const verifiedAddress = await verifySignature(
      payload,
      signature
    );

    assert.equal(
      verifiedAddress.toLowerCase(),
      account.address.toLowerCase()
    );
  });
});

test('tampered login payload is rejected', async () => {
  await withTestEnvironment(async () => {
    const payload = await generateLoginPayload(account.address);

    const message =
      __authTestUtils.createLoginMessage(payload);

    const signature = await account.signMessage({
      message,
    });

    const tampered = {
      ...payload,
      statement: 'Different statement',
    };

    await assert.rejects(
      () => verifySignature(tampered, signature)
    );
  });
});

test('expired login payload is rejected', async () => {
  await withTestEnvironment(async () => {
    const payload = await generateLoginPayload(account.address);

    payload.expiration_time =
      new Date(Date.now() - 1000).toISOString();

    const message =
      __authTestUtils.createLoginMessage(payload);

    const signature = await account.signMessage({
      message,
    });

    await assert.rejects(
      () => verifySignature(payload, signature),
      /expired/
    );
  });
});

test('generated auth token validates and preserves address', async () => {
  await withTestEnvironment(async () => {
    const payload = await generateLoginPayload(account.address);

    const message =
      __authTestUtils.createLoginMessage(payload);

    const signature = await account.signMessage({
      message,
    });

    const token = await generateToken({
      payload,
      signature,
    });

    const authenticated = await validateToken(token);

    assert.equal(
      authenticated.address.toLowerCase(),
      account.address.toLowerCase()
    );
  });
});

test('tampered auth token is rejected', async () => {
  await withTestEnvironment(async () => {
    const payload = await generateLoginPayload(account.address);

    const message =
      __authTestUtils.createLoginMessage(payload);

    const signature = await account.signMessage({
      message,
    });

    const token = await generateToken({
      payload,
      signature,
    });

    const parts = token.split('.');
    const authPayload = JSON.parse(
      Buffer.from(parts[1], 'base64').toString()
    );

    authPayload.sub =
      '0x0000000000000000000000000000000000000001';

    parts[1] = Buffer.from(
      JSON.stringify(authPayload)
    )
      .toString('base64')
      .replace(/=/g, '');

    await assert.rejects(
      () => validateToken(parts.join('.'))
    );
  });
});
