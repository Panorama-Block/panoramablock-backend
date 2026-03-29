import { TacOperationService } from '../src/application/services/TacOperationService';
import { TacOperation } from '../src/domain/entities/TacOperation';

describe('TacOperationService', () => {
  const repoMock = {
    saveOperation: jest.fn(async (op) => op),
    updateOperation: jest.fn(async (op) => op),
    findOperationById: jest.fn(),
    findOperations: jest.fn(),
    findPendingOperations: jest.fn()
  } as any;

  const sdkMock = {
    bridgeFromTon: jest.fn(async () => ({ bridgeId: 'b1', txHash: '0x1', outputAmount: '99', fees: { gas: '0.01' } })),
    bridgeToTon: jest.fn(async () => ({ bridgeId: 'b2', txHash: '0x2', outputAmount: '98', fees: { gas: '0.01' } })),
    executeProtocolOperation: jest.fn(async () => ({})),
    cancelBridge: jest.fn()
  } as any;

  const notifMock = {
    sendOperationNotification: jest.fn(async () => {})
  } as any;

  const analyticsMock = {
    trackOperationCreated: jest.fn(),
    trackOperationCompleted: jest.fn(),
    trackOperationFailed: jest.fn()
  } as any;

  const service = new TacOperationService(repoMock, sdkMock, notifMock, analyticsMock);

  it('creates an operation and initializes steps', async () => {
    const op = await service.createOperation({
      userId: 'user-1',
      operationType: 'cross_chain_swap',
      sourceChain: 'ton',
      targetChain: 'ethereum',
      inputToken: 'USDC',
      inputAmount: 100,
      outputToken: 'ETH',
      protocol: 'uniswap',
      protocolAction: 'swap'
    });

    expect(op.getSteps().length).toBeGreaterThan(0);
    expect(repoMock.saveOperation).toHaveBeenCalled();
  });

  it('handles executeOperation failure gracefully', async () => {
    const op = new TacOperation({
      userId: 'user-1',
      operationType: 'cross_chain_swap',
      status: 'initiated',
      sourceChain: 'ton',
      targetChain: 'ethereum',
      inputToken: 'USDC',
      inputAmount: '100',
      protocol: 'uniswap',
      protocolAction: 'swap'
    });
    repoMock.findOperationById.mockResolvedValue(op);
    sdkMock.bridgeFromTon.mockRejectedValueOnce(new Error('bridge failed'));

    await expect(service.executeOperation('op1')).rejects.toThrow('bridge failed');
    expect(repoMock.updateOperation).toHaveBeenCalled();
  });
});
