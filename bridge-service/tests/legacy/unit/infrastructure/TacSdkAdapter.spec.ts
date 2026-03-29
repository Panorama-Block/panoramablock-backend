import { TacSdkAdapter } from '../../../src/infrastructure/tac/TacSdkAdapter';
import { logger } from '../../../src/infrastructure/utils/logger';

// Mock logger
jest.mock('../../../src/infrastructure/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }
}));

// Mock TacSender
jest.mock('../../../src/infrastructure/tac/TacSender', () => {
    return {
        TacSender: jest.fn().mockImplementation(() => ({
            getSenderAddress: jest.fn().mockReturnValue('0:mock_sender_address'),
            sendShardTransaction: jest.fn(),
            sendShardTransactions: jest.fn(),
            getBalance: jest.fn(),
            getBalanceOf: jest.fn()
        }))
    };
});

describe('TacSdkAdapter', () => {
    let adapter: TacSdkAdapter;
    let mockSdkInstance: any;

    beforeEach(() => {
        mockSdkInstance = {
            getSimulationInfo: jest.fn(),
            sendCrossChainTransaction: jest.fn(),
            operationTracker: {
                getOperationStatus: jest.fn()
            }
        };

        adapter = new TacSdkAdapter({
            supportedChains: ['ton', 'ethereum'],
            defaultTimeout: 5000,
            maxRetries: 3,
            webhookSecret: 'secret',
            network: 'TESTNET'
        });

        // Manually inject mock SDK instance
        (adapter as any).sdkInstance = mockSdkInstance;
        (adapter as any).isInitialized = true;
    });

    describe('getBridgeQuote', () => {
        it('should use getSimulationInfo to generate a quote', async () => {
            const request = {
                from: { chain: 'ton', token: 'TON', amount: '10' },
                to: { chain: 'ethereum', token: 'WTON' }
            };

            mockSdkInstance.nativeTONAddress = '0:native_ton_address';
            mockSdkInstance.getSimulationInfo.mockResolvedValue({
                feeParams: {
                    protocolFee: BigInt(100),
                    evmExecutorFee: BigInt(200),
                    tvmExecutorFee: BigInt(300)
                }
            });

            const quotes = await adapter.getBridgeQuote(request);

            expect(mockSdkInstance.getSimulationInfo).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                [{ address: '0:native_ton_address', amount: 10 }],
                expect.objectContaining({ allowSimulationError: true })
            );
            expect(quotes).toHaveLength(1);
            expect(quotes[0].fees.total).toBe('600');
        });

        it('should fallback if getSimulationInfo is missing', async () => {
            mockSdkInstance.getSimulationInfo = undefined;
            const request = {
                from: { chain: 'ton', token: 'TON', amount: '10' },
                to: { chain: 'ethereum', token: 'WTON' }
            };

            const quotes = await adapter.getBridgeQuote(request);

            expect(quotes).toHaveLength(1);
            expect(quotes[0].outputAmount).toBeDefined();
        });
    });

    describe('initiateBridge', () => {
        it('should use sendCrossChainTransaction to initiate bridge', async () => {
            const request = {
                from: { chain: 'ton', token: 'TON', amount: '10', userWallet: '0:sender' },
                to: { chain: 'ethereum', token: 'WTON', userWallet: '0xreceiver' }
            };

            mockSdkInstance.nativeTONAddress = '0:native_ton_address';
            mockSdkInstance.sendCrossChainTransaction.mockResolvedValue({
                operationId: 'op_123',
                txHash: '0xhash'
            });

            // Inject proxy address into options
            (adapter as any).options.proxyAddress = '0xproxy';

            const response = await adapter.initiateBridge(request);

            expect(mockSdkInstance.sendCrossChainTransaction).toHaveBeenCalledWith(
                expect.objectContaining({
                    evmTargetAddress: '0xproxy',
                    methodName: 'swap'
                }),
                expect.anything(),
                [{ address: '0:native_ton_address', amount: 10 }],
                expect.objectContaining({ allowSimulationError: true })
            );
            expect(response.bridgeId).toBe('op_123');
            expect(response.metadata).toBeDefined();
            expect(response.metadata?.transactionPayload).toBeDefined();
        });
    });
});
