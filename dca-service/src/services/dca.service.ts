import { DatabaseService } from './database.service';
import { DCAStrategy, CreateStrategyRequest, ExecutionHistory, StrategyActionType } from '../types';

export class DCAService {
  private db: DatabaseService;

  constructor() {
    this.db = DatabaseService.getInstance();
  }

  /**
   * Create a new DCA strategy
   */
  async createStrategy(request: CreateStrategyRequest): Promise<{
    strategyId: string;
    nextExecution: Date;
  }> {
    const actionType: StrategyActionType = request.actionType || 'swap';
    console.log(`[DCAService] Creating ${actionType} strategy for account:`, request.smartAccountId);

    // 1. Verify smart account exists
    const accountCheck = await this.db.query(
      `SELECT 1 FROM smart_accounts WHERE address = $1`,
      [request.smartAccountId]
    );

    if (accountCheck.rows.length === 0) {
      throw new Error('Smart account not found');
    }

    // 2. Calculate next execution time
    const now = Math.floor(Date.now() / 1000);
    const intervalSeconds = this.getIntervalSeconds(request.interval);
    const nextExecution = now + intervalSeconds;

    // 3. Generate strategy ID
    const strategyId = `${request.smartAccountId}-${Date.now()}`;

    // 4. Create strategy in database
    await this.db.query(
      `INSERT INTO dca_strategies (
        id, smart_account_address, action_type, from_token, to_token,
        from_chain_id, to_chain_id, amount, "interval",
        last_executed, next_execution, is_active,
        protocol, lending_action, amount_b, token_b
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        strategyId,
        request.smartAccountId,
        actionType,
        request.fromToken,
        request.toToken,
        request.fromChainId,
        request.toChainId,
        request.amount,
        request.interval,
        0,
        nextExecution,
        true,
        request.protocol || null,
        request.action || null,
        request.amountB || null,
        request.tokenB || null,
      ]
    );

    console.log(`[DCAService] ✅ ${actionType} strategy created:`, strategyId);

    return {
      strategyId,
      nextExecution: new Date(nextExecution * 1000)
    };
  }

  /**
   * Get a single strategy by ID
   */
  async getStrategy(strategyId: string): Promise<DCAStrategy | null> {
    const result = await this.db.query(
      `SELECT
        id as "strategyId",
        smart_account_address as "smartAccountId",
        action_type as "actionType",
        from_token as "fromToken",
        to_token as "toToken",
        from_chain_id as "fromChainId",
        to_chain_id as "toChainId",
        amount,
        "interval",
        last_executed as "lastExecuted",
        next_execution as "nextExecution",
        is_active as "isActive",
        protocol,
        lending_action as "lendingAction",
        amount_b as "amountB",
        token_b as "tokenB"
       FROM dca_strategies
       WHERE id = $1`,
      [strategyId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRow(result.rows[0]);
  }

  /**
   * Get all strategies for a smart account
   */
  async getAccountStrategies(smartAccountId: string): Promise<DCAStrategy[]> {
    const result = await this.db.query(
      `SELECT
        id as "strategyId",
        smart_account_address as "smartAccountId",
        action_type as "actionType",
        from_token as "fromToken",
        to_token as "toToken",
        from_chain_id as "fromChainId",
        to_chain_id as "toChainId",
        amount,
        "interval",
        last_executed as "lastExecuted",
        next_execution as "nextExecution",
        is_active as "isActive",
        protocol,
        lending_action as "lendingAction",
        amount_b as "amountB",
        token_b as "tokenB"
       FROM dca_strategies
       WHERE smart_account_address = $1
       ORDER BY created_at DESC`,
      [smartAccountId]
    );

    return result.rows.map(row => this.mapRow(row));
  }

  /**
   * Update strategy active status
   */
  async toggleStrategy(strategyId: string, isActive: boolean): Promise<void> {
    const result = await this.db.query(
      `UPDATE dca_strategies SET is_active = $1 WHERE id = $2`,
      [isActive, strategyId]
    );

    if (result.rowCount === 0) {
      throw new Error('Strategy not found');
    }

    console.log(`[DCAService] Strategy ${strategyId} ${isActive ? 'activated' : 'deactivated'}`);
  }

  /**
   * Delete a strategy
   */
  async deleteStrategy(strategyId: string): Promise<void> {
    const result = await this.db.query(
      `DELETE FROM dca_strategies WHERE id = $1`,
      [strategyId]
    );

    if (result.rowCount === 0) {
      throw new Error('Strategy not found');
    }

    console.log('[DCAService] ✅ Strategy deleted:', strategyId);
  }

  /**
   * Get execution history for a smart account
   */
  async getExecutionHistory(smartAccountId: string, limit: number = 100): Promise<ExecutionHistory[]> {
    const result = await this.db.query(
      `SELECT
        timestamp,
        tx_hash as "txHash",
        amount,
        from_token as "fromToken",
        to_token as "toToken",
        status,
        error
       FROM execution_history
       WHERE smart_account_address = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [smartAccountId, limit]
    );

    return result.rows.map(row => ({
      timestamp: row.timestamp,
      txHash: row.txHash,
      amount: row.amount,
      fromToken: row.fromToken,
      toToken: row.toToken,
      status: row.status as 'success' | 'failed',
      error: row.error
    }));
  }

  /**
   * Add execution to history
   */
  async addExecutionHistory(smartAccountId: string, execution: ExecutionHistory): Promise<void> {
    await this.db.query(
      `INSERT INTO execution_history (
        smart_account_address, timestamp, tx_hash, amount,
        from_token, to_token, status, error
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        smartAccountId,
        execution.timestamp,
        execution.txHash,
        execution.amount,
        execution.fromToken,
        execution.toToken,
        execution.status,
        execution.error
      ]
    );
  }

  /**
   * Get strategies ready for execution
   */
  async getReadyStrategies(): Promise<string[]> {
    const now = Math.floor(Date.now() / 1000);

    const result = await this.db.query(
      `SELECT id FROM dca_strategies
       WHERE is_active = true AND next_execution <= $1
       ORDER BY next_execution ASC`,
      [now]
    );

    return result.rows.map(row => row.id);
  }

  /**
   * Update strategy after execution
   */
  async updateStrategyAfterExecution(strategyId: string): Promise<void> {
    const strategyResult = await this.db.query(
      `SELECT "interval" FROM dca_strategies WHERE id = $1`,
      [strategyId]
    );

    if (strategyResult.rows.length === 0) {
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const intervalSeconds = this.getIntervalSeconds(strategyResult.rows[0].interval as any);
    const nextExecution = now + intervalSeconds;

    await this.db.query(
      `UPDATE dca_strategies
       SET last_executed = $1, next_execution = $2
       WHERE id = $3`,
      [now, nextExecution, strategyId]
    );

    console.log(`[DCAService] Strategy ${strategyId} rescheduled for ${new Date(nextExecution * 1000)}`);
  }

  /**
   * Get interval in seconds
   */
  private getIntervalSeconds(interval: 'daily' | 'weekly' | 'monthly'): number {
    const intervals = {
      daily: 86400,
      weekly: 604800,
      monthly: 2592000
    };

    return intervals[interval];
  }

  /**
   * Map a database row to a DCAStrategy
   */
  private mapRow(row: any): DCAStrategy {
    return {
      strategyId: row.strategyId,
      smartAccountId: row.smartAccountId,
      actionType: (row.actionType || 'swap') as StrategyActionType,
      fromToken: row.fromToken,
      toToken: row.toToken,
      fromChainId: row.fromChainId,
      toChainId: row.toChainId,
      amount: row.amount,
      interval: row.interval as 'daily' | 'weekly' | 'monthly',
      lastExecuted: row.lastExecuted,
      nextExecution: row.nextExecution,
      isActive: row.isActive,
      protocol: row.protocol || undefined,
      lendingAction: row.lendingAction || undefined,
      amountB: row.amountB || undefined,
      tokenB: row.tokenB || undefined,
    };
  }
}
