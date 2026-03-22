import { DatabaseGatewayClient } from '../../src/infrastructure/clients/DatabaseGatewayClient';

describe('DatabaseGatewayClient fallback storage', () => {
  beforeEach(() => {
    delete process.env.DB_GATEWAY_URL;
    delete process.env.DB_GATEWAY_SERVICE_TOKEN;
    delete process.env.DB_GATEWAY_SYNC_ENABLED;
  });

  it('stores users in the users map and keeps events clean in fallback mode', async () => {
    const client = new DatabaseGatewayClient();

    await client.upsertUser('u1', '0xabc');

    const memory = (client as any).memory;
    expect(memory.users.get('u1')).toEqual(
      expect.objectContaining({
        userId: 'u1',
        walletAddress: '0xabc',
      })
    );
    expect(Array.from(memory.events.keys())).toEqual([]);
  });

  it('still creates wallets after fallback user upsert', async () => {
    const client = new DatabaseGatewayClient();

    const wallet = await client.createWallet({
      walletId: 'w1',
      userId: 'u1',
      chain: 'base',
      address: '0xabc',
      walletType: 'evm',
    });

    const memory = (client as any).memory;
    expect(wallet).toEqual(expect.objectContaining({ id: 'w1', userId: 'u1' }));
    expect(memory.users.get('u1')).toEqual(expect.objectContaining({ userId: 'u1' }));
    expect(memory.wallets.get('w1')).toEqual(expect.objectContaining({ id: 'w1' }));
  });
});
