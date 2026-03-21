// Unit Tests for TacOperation Domain Entity
import { TacOperation, TacOperationStatus, TacOperationType } from '../../../../src/domain/entities/TacOperation';

describe('TacOperation Entity', () => {
  describe('Constructor', () => {
    it('should create a new TacOperation with valid parameters', () => {
      const operationData = {
        userId: 'user123',
        operationType: 'cross_chain_swap' as TacOperationType,
        sourceChain: 'ton',
        targetChain: 'ethereum',
        inputToken: 'TON',
        inputAmount: 100,
        outputToken: 'USDC'
      };

      const operation = new TacOperation(operationData);

      expect(operation.userId).toBe('user123');
      expect(operation.operationType).toBe('cross_chain_swap');
      expect(operation.sourceChain).toBe('ton');
      expect(operation.targetChain).toBe('ethereum');
      expect(operation.inputToken).toBe('TON');
      expect(operation.inputAmount).toBe(100);
      expect(operation.outputToken).toBe('USDC');
      expect(operation.status).toBe('initiated');
      expect(operation.currentStep).toBe(0);
      expect(operation.canRetry).toBe(true);
      expect(operation.getSteps()).toHaveLength(0);
    });

    it('should generate a unique ID for each operation', () => {
      const operationData = {
        userId: 'user123',
        operationType: 'cross_chain_swap' as TacOperationType,
        sourceChain: 'ton',
        targetChain: 'ethereum',
        inputToken: 'TON',
        inputAmount: 100
      };

      const operation1 = new TacOperation(operationData);
      const operation2 = new TacOperation(operationData);

      expect(operation1.id).toBeDefined();
      expect(operation2.id).toBeDefined();
      expect(operation1.id).not.toBe(operation2.id);
    });

    it('should set default values correctly', () => {
      const operationData = {
        userId: 'user123',
        operationType: 'cross_chain_swap' as TacOperationType,
        sourceChain: 'ton',
        targetChain: 'ethereum',
        inputToken: 'TON',
        inputAmount: 100
      };

      const operation = new TacOperation(operationData);

      expect(operation.sourceChain).toBe('ton');
      expect(operation.status).toBe('initiated');
      expect(operation.currentStep).toBe(0);
      expect(operation.retryCount).toBe(0);
      expect(operation.canRetry).toBe(true);
    });
  });

  describe('Step Management', () => {
    let operation: TacOperation;

    beforeEach(() => {
      operation = new TacOperation({
        userId: 'user123',
        operationType: 'cross_chain_swap',
        sourceChain: 'ton',
        targetChain: 'ethereum',
        inputToken: 'TON',
        inputAmount: 100
      });
    });

    it('should add steps correctly', () => {
      operation.addStep('bridge_to_evm', { targetChain: 'ethereum' });
      operation.addStep('protocol_execution', { protocol: 'uniswap' });

      const steps = operation.getSteps();
      expect(steps).toHaveLength(2);
      expect(steps[0].stepType).toBe('bridge_to_evm');
      expect(steps[0].stepOrder).toBe(0);
      expect(steps[0].metadata).toEqual({ targetChain: 'ethereum' });
      expect(steps[1].stepType).toBe('protocol_execution');
      expect(steps[1].stepOrder).toBe(1);
    });

    it('should assign correct step orders', () => {
      operation.addStep('step1');
      operation.addStep('step2');
      operation.addStep('step3');

      const steps = operation.getSteps();
      expect(steps[0].stepOrder).toBe(0);
      expect(steps[1].stepOrder).toBe(1);
      expect(steps[2].stepOrder).toBe(2);
    });

    it('should calculate progress percentage correctly', () => {
      expect(operation.getProgressPercentage()).toBe(0);

      operation.addStep('step1');
      operation.addStep('step2');
      operation.addStep('step3');
      expect(operation.getProgressPercentage()).toBe(0);

      operation.getSteps()[0].complete();
      expect(operation.getProgressPercentage()).toBe(33);

      operation.getSteps()[1].complete();
      expect(operation.getProgressPercentage()).toBe(67);

      operation.getSteps()[2].complete();
      expect(operation.getProgressPercentage()).toBe(100);
    });
  });

  describe('Status Management', () => {
    let operation: TacOperation;

    beforeEach(() => {
      operation = new TacOperation({
        userId: 'user123',
        operationType: 'cross_chain_swap',
        sourceChain: 'ton',
        targetChain: 'ethereum',
        inputToken: 'TON',
        inputAmount: 100
      });
    });

    it('should start operation correctly', () => {
      operation.start();

      expect(operation.status).toBe('in_progress');
      expect(operation.startedAt).toBeInstanceOf(Date);
      expect(operation.completedAt).toBeNull();
    });

    it('should complete operation correctly', () => {
      operation.start();
      operation.complete();

      expect(operation.status).toBe('completed');
      expect(operation.completedAt).toBeInstanceOf(Date);
      expect(operation.canRetry).toBe(false);
    });

    it('should fail operation correctly', () => {
      const errorMessage = 'Test error';
      operation.start();
      operation.fail(errorMessage);

      expect(operation.status).toBe('failed');
      expect(operation.errorMessage).toBe(errorMessage);
      expect(operation.completedAt).toBeInstanceOf(Date);
    });

    it('should update status correctly', () => {
      operation.updateStatus('bridging_to_evm');
      expect(operation.status).toBe('bridging_to_evm');

      operation.updateStatus('executing_protocol');
      expect(operation.status).toBe('executing_protocol');

      operation.updateStatus('bridging_back');
      expect(operation.status).toBe('bridging_back');
    });

    it('should handle retry logic correctly', () => {
      operation.fail('Test error');
      expect(operation.canRetry).toBe(true);

      operation.resetForRetry();
      expect(operation.status).toBe('initiated');
      expect(operation.retryCount).toBe(1);
      expect(operation.lastRetryAt).toBeInstanceOf(Date);
      expect(operation.errorMessage).toBeNull();
      expect(operation.errorCode).toBeNull();
    });

    it('should disable retry after max attempts', () => {
      // Simulate multiple retries
      for (let i = 0; i < 5; i++) {
        operation.fail('Test error');
        if (operation.canRetry) {
          operation.resetForRetry();
        }
      }

      expect(operation.canRetry).toBe(false);
      expect(operation.retryCount).toBeGreaterThan(0);
    });
  });

  describe('Business Logic', () => {
    let operation: TacOperation;

    beforeEach(() => {
      operation = new TacOperation({
        userId: 'user123',
        operationType: 'cross_chain_swap',
        sourceChain: 'ton',
        targetChain: 'ethereum',
        inputToken: 'TON',
        inputAmount: 100
      });
    });

    it('should determine if operation can be cancelled', () => {
      expect(operation.canBeCancelled()).toBe(true);

      operation.start();
      expect(operation.canBeCancelled()).toBe(true);

      operation.complete();
      expect(operation.canBeCancelled()).toBe(false);

      operation.fail('Error');
      expect(operation.canBeCancelled()).toBe(false);
    });

    it('should validate operation types', () => {
      const validTypes: TacOperationType[] = [
        'cross_chain_swap',
        'cross_chain_lending',
        'cross_chain_staking',
        'cross_chain_yield_farming'
      ];

      validTypes.forEach(type => {
        const op = new TacOperation({
          userId: 'user123',
          operationType: type,
          sourceChain: 'ton',
          targetChain: 'ethereum',
          inputToken: 'TON',
          inputAmount: 100
        });
        expect(op.operationType).toBe(type);
      });
    });

    it('should handle estimated time correctly', () => {
      operation.estimatedTime = 300; // 5 minutes
      expect(operation.estimatedTime).toBe(300);

      operation.start();
      const startTime = operation.startedAt!.getTime();

      // Mock completion after 2 minutes
      const completionTime = new Date(startTime + 120000);
      operation.completedAt = completionTime;
      operation.actualTime = 120; // 2 minutes

      expect(operation.actualTime).toBe(120);
      expect(operation.actualTime).toBeLessThan(operation.estimatedTime);
    });

    it('should handle conversation context', () => {
      const operationWithConversation = new TacOperation({
        userId: 'user123',
        conversationId: 'conv456',
        operationType: 'cross_chain_swap',
        sourceChain: 'ton',
        targetChain: 'ethereum',
        inputToken: 'TON',
        inputAmount: 100
      });

      expect(operationWithConversation.conversationId).toBe('conv456');
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero input amount', () => {
      expect(() => new TacOperation({
        userId: 'user123',
        operationType: 'cross_chain_swap',
        sourceChain: 'ton',
        targetChain: 'ethereum',
        inputToken: 'TON',
        inputAmount: 0
      })).toThrow('Input amount must be positive');
    });

    it('should handle negative input amount', () => {
      expect(() => new TacOperation({
        userId: 'user123',
        operationType: 'cross_chain_swap',
        sourceChain: 'ton',
        targetChain: 'ethereum',
        inputToken: 'TON',
        inputAmount: -100
      })).toThrow('Input amount must be positive');
    });

    it('should handle empty user ID', () => {
      expect(() => new TacOperation({
        userId: '',
        operationType: 'cross_chain_swap',
        sourceChain: 'ton',
        targetChain: 'ethereum',
        inputToken: 'TON',
        inputAmount: 100
      })).toThrow('User ID is required');
    });

    it('should handle same source and target chain', () => {
      expect(() => new TacOperation({
        userId: 'user123',
        operationType: 'cross_chain_swap',
        sourceChain: 'ethereum',
        targetChain: 'ethereum',
        inputToken: 'TON',
        inputAmount: 100
      })).toThrow('Source and target chains must be different');
    });
  });
});