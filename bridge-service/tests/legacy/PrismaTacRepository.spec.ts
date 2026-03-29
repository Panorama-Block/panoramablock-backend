import { PrismaClient } from '@prisma/client';
import { PrismaTacRepository } from '../src/infrastructure/persistence/PrismaTacRepository';
import { TacOperation } from '../src/domain/entities/TacOperation';
import { CrossChainQuote } from '../src/domain/entities/CrossChainQuote';
import { TacBalance } from '../src/domain/entities/TacBalance';

// NOTE: These tests assume a reachable DATABASE_URL. In CI, point to a disposable test database.
describe('PrismaTacRepository', () => {
  const prisma = new PrismaClient();
  const repo = new PrismaTacRepository(prisma);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('saves and fetches an operation', async () => {
    const op = new TacOperation({
      userId: 'user-1',
      operationType: 'cross_chain_swap',
      status: 'initiated',
      sourceChain: 'ton',
      targetChain: 'ethereum',
      inputToken: 'USDC',
      inputAmount: '100'
    });

    const saved = await repo.saveOperation(op);
    expect(saved.id).toBe(op.id);

    const fetched = await repo.findOperationById(op.id);
    expect(fetched?.userId).toBe('user-1');
  });

  it('saves and fetches a quote', async () => {
    const now = new Date();
    const quote = new CrossChainQuote({
      userId: 'user-1',
      fromChain: 'ton',
      toChain: 'ethereum',
      fromToken: 'USDC',
      toToken: 'ETH',
      amount: '100',
      operationType: 'cross_chain_swap',
      route: { steps: [{ stepType: 'bridge', fromToken: 'USDC', toToken: 'USDC', protocol: 'tac', estimatedGas: '0', estimatedTime: 60 }], totalTime: 60, totalFees: { bridgeFees: '0', gasFees: '0', protocolFees: '0', total: '0' }, priceImpact: '0', minimumReceived: '99', provider: 'tac' },
      alternatives: [],
      expiresAt: new Date(now.getTime() + 60_000)
    });

    const saved = await repo.saveQuote(quote);
    expect(saved.id).toBe(quote.id);

    const fetched = await repo.findQuoteById(quote.id);
    expect(fetched?.route.provider).toBe('tac');
  });

  it('saves and fetches a balance', async () => {
    const bal = new TacBalance({
      userId: 'user-1',
      tokenSymbol: 'stETH_TON',
      tokenAddress: 'ton:steth',
      balance: '10',
      sourceProtocol: 'lido',
      sourceChain: 'ethereum'
    });

    const saved = await repo.saveBalance(bal);
    expect(saved.id).toBe(bal.id);

    const fetched = await repo.findBalanceById(bal.id);
    expect(fetched?.tokenSymbol).toBe('stETH_TON');
  });
});
