import { createPanoramaV1Routes } from '../../src/infrastructure/http/routes/panoramaV1Routes';

describe('Panorama v1 routes', () => {
  it('registers ownership/swap/staking/lending routes and removes legacy intents route', () => {
    const router = createPanoramaV1Routes({
      panoramaV1Controller: {
        createWallet: jest.fn(),
        createWalletExport: jest.fn(),
        linkWallet: jest.fn(),
        getWalletContext: jest.fn(),
        getWalletBalances: jest.fn(),
        registerWalletSession: jest.fn(),
        prepareOwnershipChallenge: jest.fn(),
        verifyOwnership: jest.fn(),
        getOwnershipStatus: jest.fn(),
        createPolicy: jest.fn(),
        approvePolicy: jest.fn(),
        revokePolicy: jest.fn(),
        createSwap: jest.fn(),
        getSwap: jest.fn(),
        createStake: jest.fn(),
        getLiquidStakePosition: jest.fn(),
        prepareLiquidStake: jest.fn(),
        prepareLiquidUnlock: jest.fn(),
        prepareLiquidRedeem: jest.fn(),
        submitPreparedLiquidOperation: jest.fn(),
        failPreparedLiquidOperation: jest.fn(),
        getStake: jest.fn(),
        getLendingMarkets: jest.fn(),
        createLendingAction: jest.fn(),
        getLendingOperation: jest.fn(),
        registerWebhook: jest.fn(),
      },
    } as any);

    const routePaths = (router as any).stack
      .filter((layer: any) => layer.route?.path)
      .map((layer: any) => String(layer.route.path));

    expect(routePaths).toContain('/wallets');
    expect(routePaths).toContain('/wallets/create-export');
    expect(routePaths).toContain('/wallets/link');
    expect(routePaths).toContain('/wallets/:id/context');
    expect(routePaths).toContain('/wallets/:id/balances');
    expect(routePaths).toContain('/wallets/:id/sessions');
    expect(routePaths).toContain('/wallets/:id/ownership-challenge');
    expect(routePaths).toContain('/wallets/:id/ownership-verify');
    expect(routePaths).toContain('/wallets/:id/ownership-status');
    expect(routePaths).toContain('/swaps');
    expect(routePaths).toContain('/staking/stake');
    expect(routePaths).toContain('/staking/liquid/position/:address');
    expect(routePaths).toContain('/staking/liquid/prepare-stake');
    expect(routePaths).toContain('/staking/liquid/prepare-request-unlock');
    expect(routePaths).toContain('/staking/liquid/prepare-redeem');
    expect(routePaths).toContain('/staking/liquid/:id/submit');
    expect(routePaths).toContain('/staking/liquid/:id/fail');
    expect(routePaths).toContain('/lending/act');
    expect(routePaths).not.toContain('/intents');
  });
});
