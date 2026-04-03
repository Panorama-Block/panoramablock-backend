import { z } from 'zod';

export type EntityAction = 'list' | 'get' | 'create' | 'update' | 'delete' | 'transact';

export interface EntityConfig {
  /** Public name exposed via HTTP routes (lowercase plural). */
  collection: string;
  /** Prisma model name (PascalCase). */
  model: string;
  /** Primary key fields required to identify the entity. */
  primaryKeys: string[];
  /** Field used to scope queries by tenant. */
  tenantField?: string;
  /** Default ordering for list results. */
  defaultOrderBy?: Record<string, 'asc' | 'desc'>;
  /** Zod schema describing the payload for creations. */
  create: z.ZodTypeAny;
  /** Zod schema describing the payload for updates. */
  update: z.ZodTypeAny;
  /** Zod schema describing supported filters. */
  filter: z.ZodTypeAny;
  /** Optional action → roles map that restricts operations. */
  allowedRoles?: Partial<Record<EntityAction, string[]>>;
}

const jsonRecord = z.any();
const isoDate = z.string().datetime();

const baseQuerySchema = z
  .object({
    where: z.record(z.any()).optional(),
    select: z.union([z.array(z.string()), z.record(z.boolean())]).optional(),
    include: z.record(z.boolean()).optional(),
    orderBy: z.record(z.enum(['asc', 'desc'])).optional(),
    cursor: z.record(z.any()).optional(),
    take: z.number().int().max(1000).optional(),
    skip: z.number().int().optional(),
    distinct: z.array(z.string()).optional()
  })
  .strict();

const entityConfigs: EntityConfig[] = [
  {
    collection: 'users',
    model: 'User',
    primaryKeys: ['userId'],
    tenantField: 'tenantId',
    defaultOrderBy: { createdAt: 'desc' },
    create: z
      .object({
        userId: z.string(),
        walletAddress: z.string().optional(),
        displayName: z.string().optional(),
        attributes: jsonRecord.optional(),
        tenantId: z.string(),
        createdAt: isoDate.optional(),
        lastSeenAt: isoDate.optional()
      })
      .strict(),
    update: z
      .object({
        walletAddress: z.string().optional(),
        displayName: z.string().optional(),
        attributes: jsonRecord.optional(),
        lastSeenAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'conversations',
    model: 'Conversation',
    primaryKeys: ['userId', 'conversationId'],
    tenantField: 'tenantId',
    defaultOrderBy: { createdAt: 'desc' },
    create: z
      .object({
        id: z.string().optional(),
        userId: z.string(),
        conversationId: z.string(),
        title: z.string().optional(),
        status: z.string().optional(),
        currentAgent: z.string().optional(),
        lastMessageId: z.string().optional(),
        contextState: jsonRecord.optional(),
        memoryState: jsonRecord.optional(),
        messageCount: z.number().int().optional(),
        createdAt: isoDate.optional(),
        updatedAt: isoDate.optional(),
        closedAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        title: z.string().optional(),
        status: z.string().optional(),
        currentAgent: z.string().optional(),
        lastMessageId: z.string().optional(),
        contextState: jsonRecord.optional(),
        memoryState: jsonRecord.optional(),
        messageCount: z.number().int().optional(),
        updatedAt: isoDate.optional(),
        closedAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'messages',
    model: 'Message',
    primaryKeys: ['messageId'],
    tenantField: 'tenantId',
    defaultOrderBy: { timestamp: 'desc' },
    create: z
      .object({
        messageId: z.string().optional(),
        userId: z.string(),
        conversationId: z.string(),
        role: z.string(),
        content: z.string(),
        agentName: z.string().optional(),
        agentType: z.string().optional(),
        requiresAction: z.boolean().optional(),
        actionType: z.string().optional(),
        metadata: jsonRecord.optional(),
        status: z.string().optional(),
        errorMessage: z.string().optional(),
        toolCalls: jsonRecord.optional(),
        toolResults: jsonRecord.optional(),
        nextAgent: z.string().optional(),
        requiresFollowup: z.boolean().optional(),
        timestamp: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        role: z.string().optional(),
        content: z.string().optional(),
        agentName: z.string().optional(),
        agentType: z.string().optional(),
        requiresAction: z.boolean().optional(),
        actionType: z.string().optional(),
        metadata: jsonRecord.optional(),
        status: z.string().optional(),
        errorMessage: z.string().optional(),
        toolCalls: jsonRecord.optional(),
        toolResults: jsonRecord.optional(),
        nextAgent: z.string().optional(),
        requiresFollowup: z.boolean().optional(),
        timestamp: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'message-tool-calls',
    model: 'MessageToolCall',
    primaryKeys: ['toolCallId'],
    tenantField: undefined,
    create: z
      .object({
        toolCallId: z.string().optional(),
        messageId: z.string(),
        toolName: z.string(),
        args: jsonRecord,
        result: jsonRecord.optional(),
        errorMessage: z.string().optional(),
        latencyMs: z.number().int().optional(),
        createdAt: isoDate.optional()
      })
      .strict(),
    update: z
      .object({
        result: jsonRecord.optional(),
        errorMessage: z.string().optional(),
        latencyMs: z.number().int().optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'agent-turns',
    model: 'AgentTurn',
    primaryKeys: ['turnId'],
    tenantField: 'tenantId',
    defaultOrderBy: { startedAt: 'desc' },
    create: z
      .object({
        turnId: z.string().optional(),
        userId: z.string(),
        conversationId: z.string(),
        agentName: z.string(),
        agentType: z.string().optional(),
        startedAt: isoDate.optional(),
        endedAt: isoDate.optional(),
        success: z.boolean().optional(),
        errorMessage: z.string().optional(),
        metadata: jsonRecord.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        agentType: z.string().optional(),
        endedAt: isoDate.optional(),
        success: z.boolean().optional(),
        errorMessage: z.string().optional(),
        metadata: jsonRecord.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'agent-shared-states',
    model: 'AgentSharedState',
    primaryKeys: ['agentName', 'userId', 'conversationId'],
    tenantField: 'tenantId',
    create: z
      .object({
        agentName: z.string(),
        userId: z.string(),
        conversationId: z.string(),
        state: jsonRecord.optional(),
        updatedAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        state: jsonRecord.optional(),
        updatedAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'conversation-memories',
    model: 'ConversationMemory',
    primaryKeys: ['memoryId'],
    tenantField: 'tenantId',
    defaultOrderBy: { createdAt: 'desc' },
    create: z
      .object({
        memoryId: z.string().optional(),
        userId: z.string(),
        conversationId: z.string().optional(),
        scope: z.string(),
        memoryType: z.string(),
        label: z.string().optional(),
        payload: jsonRecord,
        embedding: z.union([z.string(), z.array(z.number()), z.instanceof(Uint8Array)]).optional(),
        importanceScore: z.number().optional(),
        expiresAt: isoDate.optional(),
        createdAt: isoDate.optional(),
        updatedAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        scope: z.string().optional(),
        memoryType: z.string().optional(),
        label: z.string().optional(),
        payload: jsonRecord.optional(),
        embedding: z.union([z.string(), z.array(z.number()), z.instanceof(Uint8Array)]).optional(),
        importanceScore: z.number().optional(),
        expiresAt: isoDate.optional(),
        updatedAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'swap-sessions',
    model: 'SwapSession',
    primaryKeys: ['userId', 'conversationId'],
    tenantField: 'tenantId',
    create: z
      .object({
        userId: z.string(),
        conversationId: z.string(),
        status: z.string(),
        event: z.string(),
        intent: jsonRecord,
        missingFields: z.array(z.string()),
        nextField: z.string().optional(),
        pendingQuestion: z.string().optional(),
        choices: jsonRecord.optional(),
        errorMessage: z.string().optional(),
        historyCursor: z.number().int().optional(),
        updatedAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        status: z.string().optional(),
        event: z.string().optional(),
        intent: jsonRecord.optional(),
        missingFields: z.array(z.string()).optional(),
        nextField: z.string().optional(),
        pendingQuestion: z.string().optional(),
        choices: jsonRecord.optional(),
        errorMessage: z.string().optional(),
        historyCursor: z.number().int().optional(),
        updatedAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'swap-histories',
    model: 'SwapHistory',
    primaryKeys: ['historyId'],
    tenantField: 'tenantId',
    defaultOrderBy: { recordedAt: 'desc' },
    create: z
      .object({
        historyId: z.string().optional(),
        userId: z.string(),
        conversationId: z.string(),
        status: z.string(),
        fromNetwork: z.string().optional(),
        fromToken: z.string().optional(),
        toNetwork: z.string().optional(),
        toToken: z.string().optional(),
        amount: z.number().optional(),
        errorMessage: z.string().optional(),
        recordedAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        status: z.string().optional(),
        fromNetwork: z.string().optional(),
        fromToken: z.string().optional(),
        toNetwork: z.string().optional(),
        toToken: z.string().optional(),
        amount: z.number().optional(),
        errorMessage: z.string().optional(),
        recordedAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'dca-sessions',
    model: 'DcaSession',
    primaryKeys: ['userId', 'conversationId'],
    tenantField: 'tenantId',
    create: z
      .object({
        userId: z.string(),
        conversationId: z.string(),
        status: z.string(),
        stage: z.string().optional(),
        event: z.string().optional(),
        intent: jsonRecord,
        missingFields: z.array(z.string()),
        nextField: z.string().optional(),
        pendingQuestion: z.string().optional(),
        choices: jsonRecord.optional(),
        errorMessage: z.string().optional(),
        historyCursor: z.number().int().optional(),
        updatedAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        status: z.string().optional(),
        stage: z.string().optional(),
        event: z.string().optional(),
        intent: jsonRecord.optional(),
        missingFields: z.array(z.string()).optional(),
        nextField: z.string().optional(),
        pendingQuestion: z.string().optional(),
        choices: jsonRecord.optional(),
        errorMessage: z.string().optional(),
        historyCursor: z.number().int().optional(),
        updatedAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'dca-histories',
    model: 'DcaHistory',
    primaryKeys: ['historyId'],
    tenantField: 'tenantId',
    defaultOrderBy: { recordedAt: 'desc' },
    create: z
      .object({
        historyId: z.string().optional(),
        userId: z.string(),
        conversationId: z.string(),
        summary: z.string().optional(),
        workflowType: z.string().optional(),
        cadence: jsonRecord.optional(),
        tokens: jsonRecord.optional(),
        amounts: jsonRecord.optional(),
        strategy: jsonRecord.optional(),
        venue: z.string().optional(),
        slippageBps: z.number().int().optional(),
        stopConditions: jsonRecord.optional(),
        metadata: jsonRecord.optional(),
        errorMessage: z.string().optional(),
        recordedAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        summary: z.string().optional(),
        workflowType: z.string().optional(),
        cadence: jsonRecord.optional(),
        tokens: jsonRecord.optional(),
        amounts: jsonRecord.optional(),
        strategy: jsonRecord.optional(),
        venue: z.string().optional(),
        slippageBps: z.number().int().optional(),
        stopConditions: jsonRecord.optional(),
        metadata: jsonRecord.optional(),
        errorMessage: z.string().optional(),
        recordedAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'dca-workflows',
    model: 'DcaWorkflow',
    primaryKeys: ['workflowId'],
    tenantField: 'tenantId',
    defaultOrderBy: { createdAt: 'desc' },
    create: z
      .object({
        workflowId: z.string().optional(),
        userId: z.string(),
        conversationId: z.string().optional(),
        walletAddress: z.string().optional(),
        status: z.string(),
        strategyId: z.string().optional(),
        strategyVersion: z.string().optional(),
        strategyName: z.string().optional(),
        strategy: jsonRecord.optional(),
        cadence: jsonRecord.optional(),
        tokens: jsonRecord.optional(),
        amounts: jsonRecord.optional(),
        metadata: jsonRecord.optional(),
        guardrails: jsonRecord.optional(),
        nextRunAt: isoDate.optional(),
        lastRunAt: isoDate.optional(),
        pausedAt: isoDate.optional(),
        cancelledAt: isoDate.optional(),
        createdAt: isoDate.optional(),
        updatedAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        userId: z.string().optional(),
        conversationId: z.string().optional(),
        walletAddress: z.string().optional(),
        status: z.string().optional(),
        strategyId: z.string().optional(),
        strategyVersion: z.string().optional(),
        strategyName: z.string().optional(),
        strategy: jsonRecord.optional(),
        cadence: jsonRecord.optional(),
        tokens: jsonRecord.optional(),
        amounts: jsonRecord.optional(),
        metadata: jsonRecord.optional(),
        guardrails: jsonRecord.optional(),
        nextRunAt: isoDate.optional(),
        lastRunAt: isoDate.optional(),
        pausedAt: isoDate.optional(),
        cancelledAt: isoDate.optional(),
        updatedAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'dca-runs',
    model: 'DcaRun',
    primaryKeys: ['runId'],
    tenantField: 'tenantId',
    defaultOrderBy: { executedAt: 'desc' },
    create: z
      .object({
        runId: z.string().optional(),
        workflowId: z.string(),
        status: z.string(),
        executedAt: isoDate.optional(),
        txHash: z.string().optional(),
        amountExecuted: jsonRecord.optional(),
        errorMessage: z.string().optional(),
        metadata: jsonRecord.optional(),
        createdAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        status: z.string().optional(),
        executedAt: isoDate.optional(),
        txHash: z.string().optional(),
        amountExecuted: jsonRecord.optional(),
        errorMessage: z.string().optional(),
        metadata: jsonRecord.optional(),
        createdAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'lending-markets',
    model: 'LendingMarket',
    primaryKeys: ['marketId'],
    tenantField: 'tenantId',
    defaultOrderBy: { updatedAt: 'desc' },
    create: z
      .object({
        marketId: z.string().optional(),
        chainId: z.number().int(),
        protocol: z.string().optional(),
        qTokenAddress: z.string(),
        qTokenSymbol: z.string(),
        underlyingAddress: z.string(),
        underlyingSymbol: z.string(),
        underlyingDecimals: z.number().int().optional(),
        collateralFactorBps: z.number().int().optional(),
        liquidationIncentiveBps: z.number().int().optional(),
        supplyApyBps: z.number().int().optional(),
        borrowApyBps: z.number().int().optional(),
        isActive: z.boolean().optional(),
        metadata: jsonRecord.optional(),
        createdAt: isoDate.optional(),
        updatedAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        protocol: z.string().optional(),
        qTokenSymbol: z.string().optional(),
        underlyingSymbol: z.string().optional(),
        underlyingDecimals: z.number().int().optional(),
        collateralFactorBps: z.number().int().optional(),
        liquidationIncentiveBps: z.number().int().optional(),
        supplyApyBps: z.number().int().optional(),
        borrowApyBps: z.number().int().optional(),
        isActive: z.boolean().optional(),
        metadata: jsonRecord.optional(),
        updatedAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'lending-positions',
    model: 'LendingPosition',
    primaryKeys: ['positionId'],
    tenantField: 'tenantId',
    defaultOrderBy: { updatedAt: 'desc' },
    create: z
      .object({
        positionId: z.string().optional(),
        userId: z.string(),
        marketId: z.string(),
        suppliedWei: z.string().optional(),
        borrowedWei: z.string().optional(),
        collateralEnabled: z.boolean().optional(),
        createdAt: isoDate.optional(),
        updatedAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        suppliedWei: z.string().optional(),
        borrowedWei: z.string().optional(),
        collateralEnabled: z.boolean().optional(),
        updatedAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'lending-snapshots',
    model: 'LendingSnapshotDaily',
    primaryKeys: ['snapshotId'],
    tenantField: 'tenantId',
    defaultOrderBy: { date: 'desc' },
    create: z
      .object({
        snapshotId: z.string().optional(),
        userId: z.string(),
        chainId: z.number().int(),
        date: isoDate,
        totalSuppliedWei: z.string().optional(),
        totalBorrowedWei: z.string().optional(),
        liquidityWei: z.string().optional(),
        shortfallWei: z.string().optional(),
        healthFactor: z.string().optional(),
        metadata: jsonRecord.optional(),
        createdAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        totalSuppliedWei: z.string().optional(),
        totalBorrowedWei: z.string().optional(),
        liquidityWei: z.string().optional(),
        shortfallWei: z.string().optional(),
        healthFactor: z.string().optional(),
        metadata: jsonRecord.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'lending-txs',
    model: 'LendingTx',
    primaryKeys: ['txId'],
    tenantField: 'tenantId',
    defaultOrderBy: { createdAt: 'desc' },
    create: z
      .object({
        txId: z.string().optional(),
        userId: z.string(),
        chainId: z.number().int(),
        action: z.string(),
        amountWei: z.string().optional(),
        txHash: z.string().optional(),
        status: z.string().optional(),
        errorMessage: z.string().optional(),
        metadata: jsonRecord.optional(),
        createdAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        amountWei: z.string().optional(),
        txHash: z.string().optional(),
        status: z.string().optional(),
        errorMessage: z.string().optional(),
        metadata: jsonRecord.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'lido-positions',
    model: 'LidoPosition',
    primaryKeys: ['positionId'],
    tenantField: 'tenantId',
    defaultOrderBy: { updatedAt: 'desc' },
    create: z
      .object({
        positionId: z.string().optional(),
        userId: z.string(),
        chainId: z.number().int().optional(),
        stethWei: z.string().optional(),
        wstethWei: z.string().optional(),
        apyBps: z.number().int().optional(),
        createdAt: isoDate.optional(),
        updatedAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        stethWei: z.string().optional(),
        wstethWei: z.string().optional(),
        apyBps: z.number().int().optional(),
        updatedAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'lido-withdrawals',
    model: 'LidoWithdrawal',
    primaryKeys: ['withdrawalId'],
    tenantField: 'tenantId',
    defaultOrderBy: { createdAt: 'desc' },
    create: z
      .object({
        withdrawalId: z.string().optional(),
        userId: z.string(),
        chainId: z.number().int().optional(),
        requestId: z.string(),
        amountStEthWei: z.string(),
        finalized: z.boolean().optional(),
        claimed: z.boolean().optional(),
        requestedAt: isoDate.optional(),
        finalizedAt: isoDate.optional(),
        claimedAt: isoDate.optional(),
        metadata: jsonRecord.optional(),
        createdAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        finalized: z.boolean().optional(),
        claimed: z.boolean().optional(),
        finalizedAt: isoDate.optional(),
        claimedAt: isoDate.optional(),
        metadata: jsonRecord.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'lido-txs',
    model: 'LidoTx',
    primaryKeys: ['txId'],
    tenantField: 'tenantId',
    defaultOrderBy: { createdAt: 'desc' },
    create: z
      .object({
        txId: z.string().optional(),
        userId: z.string(),
        chainId: z.number().int().optional(),
        action: z.string(),
        amountWei: z.string().optional(),
        txHash: z.string().optional(),
        status: z.string().optional(),
        errorMessage: z.string().optional(),
        metadata: jsonRecord.optional(),
        createdAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        amountWei: z.string().optional(),
        txHash: z.string().optional(),
        status: z.string().optional(),
        errorMessage: z.string().optional(),
        metadata: jsonRecord.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'agent-metrics',
    model: 'AgentMetric',
    primaryKeys: ['metricId'],
    tenantField: 'tenantId',
    defaultOrderBy: { createdAt: 'desc' },
    create: z
      .object({
        metricId: z.string().optional(),
        agentName: z.string(),
        agentType: z.string().optional(),
        userId: z.string().optional(),
        conversationId: z.string().optional(),
        responseTimeMs: z.number().int().optional(),
        success: z.boolean(),
        errorMessage: z.string().optional(),
        tokensInput: z.number().int().optional(),
        tokensOutput: z.number().int().optional(),
        createdAt: isoDate.optional(),
        tenantId: z.string()
      })
      .strict(),
    update: z
      .object({
        agentType: z.string().optional(),
        userId: z.string().optional(),
        conversationId: z.string().optional(),
        responseTimeMs: z.number().int().optional(),
        success: z.boolean().optional(),
        errorMessage: z.string().optional(),
        tokensInput: z.number().int().optional(),
        tokensOutput: z.number().int().optional(),
        createdAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'outbox',
    model: 'Outbox',
    primaryKeys: ['id'],
    tenantField: undefined,
    defaultOrderBy: { occurredAt: 'desc' },
    allowedRoles: {
      list: ['admin'],
      get: ['admin']
    },
    create: z
      .object({
        id: z.string().optional(),
        entity: z.string(),
        op: z.string(),
        payload: jsonRecord,
        occurredAt: isoDate.optional(),
        processedAt: isoDate.optional(),
        attempts: z.number().int().optional()
      })
      .strict(),
    update: z
      .object({
        processedAt: isoDate.optional(),
        attempts: z.number().int().optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'idempotency-keys',
    model: 'IdempotencyKey',
    primaryKeys: ['key'],
    tenantField: undefined,
    allowedRoles: {
      list: ['admin'],
      get: ['admin']
    },
    create: z
      .object({
        key: z.string(),
        requestHash: z.string(),
        response: jsonRecord,
        createdAt: isoDate.optional()
      })
      .strict(),
    update: z
      .object({
        response: jsonRecord.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },

  // ============================================================================
  // WALLET & PORTFOLIO TRACKING
  // ============================================================================

  {
    collection: 'wallets',
    model: 'Wallet',
    primaryKeys: ['id'],
    tenantField: 'tenantId',
    defaultOrderBy: { createdAt: 'desc' },
    create: z
      .object({
        id: z.string().uuid().optional(),
        userId: z.string(),
        chain: z.string(),
        address: z.string(),
        walletType: z.enum(['ton', 'evm', 'smart_wallet', 'panorama_wallet']),
        name: z.string().optional(),
        isPrimary: z.boolean().optional(),
        isActive: z.boolean().optional(),
        metadata: jsonRecord.optional(),
        tenantId: z.string(),
        createdAt: isoDate.optional(),
        updatedAt: isoDate.optional()
      })
      .strict(),
    update: z
      .object({
        name: z.string().optional(),
        isPrimary: z.boolean().optional(),
        isActive: z.boolean().optional(),
        metadata: jsonRecord.optional(),
        updatedAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'position-snapshots',
    model: 'PositionSnapshot',
    primaryKeys: ['id'],
    tenantField: 'tenantId',
    defaultOrderBy: { snapshotTimestamp: 'desc' },
    create: z
      .object({
        id: z.string().uuid().optional(),
        userId: z.string(),
        walletId: z.string().uuid(),
        chain: z.string(),
        protocol: z.string(),
        market: z.string().optional(),
        positionType: z.enum(['balance', 'supply', 'borrow', 'stake', 'lp', 'derivative', 'reward']),
        assetAddress: z.string(),
        assetSymbol: z.string(),
        assetDecimals: z.number().int(),
        amountRaw: z.string(),
        amountDisplay: z.string(),
        amountUsd: z.string().optional(),
        priceUsd: z.string().optional(),
        accruedRaw: z.string().optional(),
        accruedDisplay: z.string().optional(),
        apy: z.string().optional(),
        healthFactor: z.string().optional(),
        snapshotBlock: z.union([z.number(), z.bigint()]).optional(),
        snapshotTimestamp: isoDate,
        source: z.enum(['onchain', 'cached', 'api']),
        metadata: jsonRecord.optional(),
        tenantId: z.string(),
        createdAt: isoDate.optional()
      })
      .strict(),
    update: z
      .object({
        amountRaw: z.string().optional(),
        amountDisplay: z.string().optional(),
        amountUsd: z.string().optional(),
        priceUsd: z.string().optional(),
        accruedRaw: z.string().optional(),
        accruedDisplay: z.string().optional(),
        apy: z.string().optional(),
        healthFactor: z.string().optional(),
        metadata: jsonRecord.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'transactions',
    model: 'Transaction',
    primaryKeys: ['id'],
    tenantField: 'tenantId',
    defaultOrderBy: { createdAt: 'desc' },
    create: z
      .object({
        id: z.string().uuid().optional(),
        userId: z.string(),
        walletId: z.string().uuid(),
        conversationId: z.string().optional(),
        action: z.enum([
          'swap',
          'bridge',
          'stake',
          'unstake',
          'supply',
          'withdraw',
          'borrow',
          'repay',
          'claim',
          'approve'
        ]),
        protocol: z.string().optional(),
        // From
        fromChainId: z.number().int(),
        fromAssetAddress: z.string(),
        fromAssetSymbol: z.string(),
        fromAssetDecimals: z.number().int(),
        fromAmountRaw: z.string(),
        fromAmountDisplay: z.string(),
        fromAmountUsd: z.string().optional(),
        // To
        toChainId: z.number().int().optional(),
        toAssetAddress: z.string().optional(),
        toAssetSymbol: z.string().optional(),
        toAssetDecimals: z.number().int().optional(),
        toAmountRaw: z.string().optional(),
        toAmountDisplay: z.string().optional(),
        toAmountUsd: z.string().optional(),
        // Execution
        txHashes: z.array(
          z.object({
            hash: z.string(),
            chainId: z.number().int(),
            type: z.enum(['approval', 'swap', 'bridge', 'stake', 'lend', 'other']).optional(),
            status: z.enum(['pending', 'success', 'failed']).optional()
          })
        ).default([]),
        status: z
          .enum(['created', 'submitted', 'pending', 'confirmed', 'failed', 'refunded'])
          .default('created'),
        provider: z.string().optional(),
        // Fees
        gasFee: z.string().optional(),
        bridgeFee: z.string().optional(),
        protocolFee: z.string().optional(),
        totalFeeUsd: z.string().optional(),
        // Exchange info
        exchangeRate: z.string().optional(),
        slippage: z.string().optional(),
        priceImpact: z.string().optional(),
        // Error
        errorCode: z.string().optional(),
        errorMessage: z.string().optional(),
        // Bridge
        bridgeId: z.string().optional(),
        // Meta
        metadata: jsonRecord.optional(),
        tenantId: z.string(),
        createdAt: isoDate.optional(),
        updatedAt: isoDate.optional(),
        confirmedAt: isoDate.optional()
      })
      .strict(),
    update: z
      .object({
        // To (pode ser atualizado após execução com valor real)
        toAmountRaw: z.string().optional(),
        toAmountDisplay: z.string().optional(),
        toAmountUsd: z.string().optional(),
        // Execution
        txHashes: z
          .array(
            z.object({
              hash: z.string(),
              chainId: z.number().int(),
              type: z.enum(['approval', 'swap', 'bridge', 'stake', 'lend', 'other']).optional(),
              status: z.enum(['pending', 'success', 'failed']).optional()
            })
          )
          .optional(),
        status: z
          .enum(['created', 'submitted', 'pending', 'confirmed', 'failed', 'refunded'])
          .optional(),
        // Fees
        gasFee: z.string().optional(),
        bridgeFee: z.string().optional(),
        protocolFee: z.string().optional(),
        totalFeeUsd: z.string().optional(),
        // Error
        errorCode: z.string().optional(),
        errorMessage: z.string().optional(),
        // Bridge
        bridgeId: z.string().optional(),
        // Meta
        metadata: jsonRecord.optional(),
        updatedAt: isoDate.optional(),
        confirmedAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
  {
    collection: 'notifications',
    model: 'Notification',
    primaryKeys: ['id'],
    tenantField: 'tenantId',
    defaultOrderBy: { createdAt: 'desc' },
    create: z
      .object({
        id: z.string().uuid().optional(),
        userId: z.string(),
        transactionId: z.string().uuid().optional(),
        type: z.enum([
          'tx_confirmed',
          'tx_failed',
          'health_warning',
          'price_alert',
          'dca_executed',
          'stake_matured',
          'welcome'
        ]),
        title: z.string(),
        message: z.string(),
        payload: jsonRecord.optional(),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
        actionUrl: z.string().optional(),
        actionLabel: z.string().optional(),
        isRead: z.boolean().default(false),
        isDismissed: z.boolean().default(false),
        expiresAt: isoDate.optional(),
        tenantId: z.string(),
        createdAt: isoDate.optional(),
        readAt: isoDate.optional()
      })
      .strict(),
    update: z
      .object({
        isRead: z.boolean().optional(),
        isDismissed: z.boolean().optional(),
        readAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },

  // ============================================================================
  // USER PROFILE
  // ============================================================================

  {
    collection: 'user-profiles',
    model: 'UserProfile',
    primaryKeys: ['id'],
    tenantField: 'tenantId',
    defaultOrderBy: { createdAt: 'desc' },
    create: z
      .object({
        id: z.string().uuid().optional(),
        walletAddress: z.string(),
        nickname: z.string().max(30).optional(),
        investorType: z.enum(['conservative', 'moderate', 'aggressive', 'degen']).optional(),
        goals: z.array(z.string()).optional(),
        preferredChains: z.array(z.string()).optional(),
        riskTolerance: z.number().int().min(1).max(10).optional(),
        metadata: jsonRecord.optional(),
        tenantId: z.string(),
        createdAt: isoDate.optional(),
        updatedAt: isoDate.optional()
      })
      .strict(),
    update: z
      .object({
        nickname: z.string().max(30).optional(),
        investorType: z.enum(['conservative', 'moderate', 'aggressive', 'degen']).optional(),
        goals: z.array(z.string()).optional(),
        preferredChains: z.array(z.string()).optional(),
        riskTolerance: z.number().int().min(1).max(10).optional(),
        metadata: jsonRecord.optional(),
        updatedAt: isoDate.optional()
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required'
      }),
    filter: baseQuerySchema
  },
];

export const entityConfigByCollection: Record<string, EntityConfig> = Object.fromEntries(
  entityConfigs.map((cfg) => [cfg.collection, cfg])
);

export const entityConfigByModel: Record<string, EntityConfig> = Object.fromEntries(
  entityConfigs.map((cfg) => [cfg.model, cfg])
);

export type EntityCollection = keyof typeof entityConfigByCollection;
