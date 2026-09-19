import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function loadAuthRouteSource(): string {
  return fs.readFileSync(
    path.join(__dirname, 'auth.ts'),
    'utf8'
  );
}

test(
  'PB identity persistence occurs after signature verification and before JWT/session issuance',
  () => {
    const source = loadAuthRouteSource();

    const verify = source.indexOf(
      'const address = await verifySignature(payload, signature);'
    );

    const persist = source.indexOf(
      'identityService.ensureAuthenticatedEvmIdentity(address)'
    );

    const canonical = source.indexOf(
      'const canonicalAddress = identity.walletAddress;'
    );

    const token = source.indexOf(
      'const token = await generateToken({ payload, signature });'
    );

    const session = source.indexOf(
      'const sessionId = createSessionId();'
    );

    const redisWrite = source.indexOf(
      'await redisClient.set(`session:${sessionId}`'
    );

    assert.ok(
      verify >= 0,
      'signature verification boundary must exist'
    );

    assert.ok(
      persist > verify,
      'identity persistence must occur after signature verification'
    );

    assert.ok(
      canonical > persist,
      'canonical identity must come from successful persistence'
    );

    assert.ok(
      token > canonical,
      'JWT generation must occur after identity persistence'
    );

    assert.ok(
      session > token,
      'session ID generation must occur after JWT generation'
    );

    assert.ok(
      redisWrite > session,
      'Redis session write must occur after identity persistence'
    );
  }
);

test(
  'successful auth session and response use the canonical persisted wallet address',
  () => {
    const source = loadAuthRouteSource();

    assert.match(
      source,
      /userId:\s*canonicalAddress/
    );

    const canonicalAddressUses =
      source.match(/address:\s*canonicalAddress/g) ?? [];

    assert.ok(
      canonicalAddressUses.length >= 2,
      'session and auth response must use canonicalAddress'
    );
  }
);

test(
  'auth route defaults to production identity persistence service',
  () => {
    const source = loadAuthRouteSource();

    assert.match(
      source,
      /identityService:\s*Pick<[\s\S]*?ensureAuthenticatedEvmIdentity[\s\S]*?>\s*=\s*identityPersistenceService/
    );

    assert.match(
      source,
      /await identityService\.ensureAuthenticatedEvmIdentity\(address\)/
    );
  }
);
