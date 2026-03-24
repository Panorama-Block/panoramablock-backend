/**
 * Circuit Breaker Service
 * Prevents cascading failures when external APIs fail
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, requests are blocked
 * - HALF_OPEN: Testing if service recovered, limited requests pass through
 */

interface CircuitBreakerOptions {
  failureThreshold: number;      // Number of failures before opening circuit
  successThreshold: number;      // Number of successes to close circuit from half-open
  timeout: number;               // Time in ms before attempting to close circuit
  monitoringWindow: number;      // Time window in ms to track failures
}

interface CircuitBreakerStats {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  nextAttemptTime: number | null;
}

export class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private nextAttemptTime: number | null = null;
  private name: string;
  private options: CircuitBreakerOptions;

  // Track failures within monitoring window
  private recentFailures: number[] = [];

  constructor(name: string, options?: Partial<CircuitBreakerOptions>) {
    this.name = name;
    this.options = {
      failureThreshold: options?.failureThreshold ?? 5,
      successThreshold: options?.successThreshold ?? 2,
      timeout: options?.timeout ?? 60000, // 1 minute
      monitoringWindow: options?.monitoringWindow ?? 120000, // 2 minutes
    };

    console.log(`[Circuit Breaker] ${this.name} initialized:`, this.options);
  }

  /**
   * Execute a function with circuit breaker protection
   * @param fn Function to execute
   * @returns Result of function execution
   * @throws Error if circuit is open or function fails
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === 'OPEN') {
      // Check if we should attempt to half-open
      if (this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
        console.log(`[Circuit Breaker] ${this.name} transitioning to HALF_OPEN`);
        this.state = 'HALF_OPEN';
        this.successCount = 0;
      } else {
        const waitTime = this.nextAttemptTime ? Math.ceil((this.nextAttemptTime - Date.now()) / 1000) : 0;
        console.warn(`[Circuit Breaker] ${this.name} is OPEN. Wait ${waitTime}s before retry.`);
        throw new Error(`Circuit breaker ${this.name} is OPEN. Service temporarily unavailable.`);
      }
    }

    try {
      // Execute the function
      const result = await fn();

      // Record success
      this.onSuccess();

      return result;
    } catch (error) {
      // Skip circuit breaker counting for user-data errors (e.g. insufficient funds).
      // These are not service failures and should not affect circuit state.
      if ((error as any)?.skipCircuitBreaker) {
        throw error;
      }

      // Record failure
      this.onFailure();

      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.lastSuccessTime = Date.now();
    this.failureCount = 0;
    this.recentFailures = [];

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      console.log(`[Circuit Breaker] ${this.name} success in HALF_OPEN state (${this.successCount}/${this.options.successThreshold})`);

      if (this.successCount >= this.options.successThreshold) {
        console.log(`[Circuit Breaker] ${this.name} closing circuit after ${this.successCount} successes`);
        this.state = 'CLOSED';
        this.successCount = 0;
        this.nextAttemptTime = null;
      }
    } else if (this.state === 'CLOSED') {
      // Normal operation
      console.log(`[Circuit Breaker] ${this.name} success in CLOSED state`);
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    const now = Date.now();
    this.lastFailureTime = now;
    this.failureCount++;

    // Add to recent failures
    this.recentFailures.push(now);

    // Remove old failures outside monitoring window
    const windowStart = now - this.options.monitoringWindow;
    this.recentFailures = this.recentFailures.filter(time => time > windowStart);

    console.warn(`[Circuit Breaker] ${this.name} failure recorded. Recent failures: ${this.recentFailures.length}/${this.options.failureThreshold}`);

    // Check if we should open the circuit
    if (this.state === 'HALF_OPEN') {
      // Immediately open on failure in half-open state
      console.error(`[Circuit Breaker] ${this.name} failed in HALF_OPEN state. Opening circuit.`);
      this.openCircuit();
    } else if (this.recentFailures.length >= this.options.failureThreshold) {
      // Open circuit if threshold exceeded
      console.error(`[Circuit Breaker] ${this.name} failure threshold exceeded. Opening circuit.`);
      this.openCircuit();
    }
  }

  /**
   * Open the circuit
   */
  private openCircuit(): void {
    this.state = 'OPEN';
    this.nextAttemptTime = Date.now() + this.options.timeout;
    this.successCount = 0;

    const nextAttempt = new Date(this.nextAttemptTime).toISOString();
    console.error(`[Circuit Breaker] ${this.name} is now OPEN. Will attempt to half-open at ${nextAttempt}`);
  }

  /**
   * Get current circuit breaker stats
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.recentFailures.length,
      successes: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttemptTime: this.nextAttemptTime,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    console.log(`[Circuit Breaker] ${this.name} manually reset`);
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.recentFailures = [];
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
  }

  /**
   * Check if circuit is operational
   */
  isOperational(): boolean {
    return this.state === 'CLOSED' || this.state === 'HALF_OPEN';
  }
}

/**
 * Circuit Breaker Manager
 * Manages multiple circuit breakers for different services
 */
export class CircuitBreakerManager {
  private static breakers: Map<string, CircuitBreaker> = new Map();

  /**
   * Get or create a circuit breaker for a service
   */
  static getBreaker(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(name, options));
    }
    return this.breakers.get(name)!;
  }

  /**
   * Get stats for all circuit breakers
   */
  static getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    this.breakers.forEach((breaker, name) => {
      stats[name] = breaker.getStats();
    });
    return stats;
  }

  /**
   * Reset all circuit breakers
   */
  static resetAll(): void {
    console.log('[Circuit Breaker Manager] Resetting all circuit breakers');
    this.breakers.forEach(breaker => breaker.reset());
  }
}

// Pre-configured circuit breakers for common services
export const CIRCUIT_BREAKERS = {
  THIRDWEB: 'thirdweb-api',
  UNISWAP_QUOTER: 'uniswap-quoter',
  UNISWAP_ROUTER: 'uniswap-router',
  REDIS: 'redis',
} as const;
