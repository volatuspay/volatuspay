type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  monitorWindow?: number;
  onStateChange?: (from: CircuitState, to: CircuitState, name: string) => void;
}

interface CircuitStats {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
  totalShortCircuited: number;
  uptimeMs: number;
}

class CircuitBreaker {
  private name: string;
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private failureThreshold: number;
  private successThreshold: number;
  private timeout: number;
  private lastFailureTime = 0;
  private lastSuccessTime = 0;
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private totalShortCircuited = 0;
  private startTime = Date.now();
  private onStateChange?: (from: CircuitState, to: CircuitState, name: string) => void;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.timeout = options.timeout ?? 60000;
    this.onStateChange = options.onStateChange;
  }

  async execute<T>(fn: () => Promise<T>, fallback?: () => T | Promise<T>): Promise<T> {
    this.totalCalls++;

    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.timeout) {
        this.transition('HALF_OPEN');
      } else {
        this.totalShortCircuited++;
        console.warn(`⚡ [CircuitBreaker:${this.name}] OPEN - short-circuiting call`);
        if (fallback) return fallback();
        throw new Error(`CircuitBreaker ${this.name} is OPEN`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      if (fallback) {
        console.warn(`⚡ [CircuitBreaker:${this.name}] Call failed, using fallback`);
        return fallback();
      }
      throw error;
    }
  }

  private onSuccess(): void {
    this.totalSuccesses++;
    this.lastSuccessTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.successThreshold) {
        this.transition('CLOSED');
      }
    }

    if (this.state === 'CLOSED') {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.totalFailures++;
    this.lastFailureTime = Date.now();
    this.failures++;

    if (this.state === 'HALF_OPEN') {
      this.transition('OPEN');
    } else if (this.state === 'CLOSED' && this.failures >= this.failureThreshold) {
      this.transition('OPEN');
    }
  }

  private transition(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.failures = 0;
    this.successes = 0;
    console.log(`⚡ [CircuitBreaker:${this.name}] ${oldState} → ${newState}`);
    this.onStateChange?.(oldState, newState, this.name);
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): CircuitStats {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      totalShortCircuited: this.totalShortCircuited,
      uptimeMs: Date.now() - this.startTime
    };
  }

  isAvailable(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      return Date.now() - this.lastFailureTime >= this.timeout;
    }
    return true;
  }

  reset(): void {
    this.transition('CLOSED');
  }
}

const registry = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  const existing = registry.get(options.name);
  if (existing) return existing;

  const cb = new CircuitBreaker(options);
  registry.set(options.name, cb);
  return cb;
}

export function getAllCircuitBreakerStats(): CircuitStats[] {
  return Array.from(registry.values()).map(cb => cb.getStats());
}

const stateChangeLogger = (from: CircuitState, to: CircuitState, name: string) => {
  if (to === 'OPEN') {
    console.error(`🚨 [CIRCUIT BREAKER] ${name}: ABERTO - Serviço indisponível, usando fallback`);
  } else if (to === 'CLOSED') {
    console.log(`✅ [CIRCUIT BREAKER] ${name}: FECHADO - Serviço normalizado`);
  }
};

export const serviceBreakers = {
  efibank: getCircuitBreaker({
    name: 'EfíBank-Pix',
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 30000,
    onStateChange: stateChangeLogger
  }),
  stripe: getCircuitBreaker({
    name: 'Stripe',
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000,
    onStateChange: stateChangeLogger
  }),
  woovi: getCircuitBreaker({
    name: 'Woovi-OpenPix',
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 30000,
    onStateChange: stateChangeLogger
  }),
  openai: getCircuitBreaker({
    name: 'OpenAI-Fraud',
    failureThreshold: 3,
    successThreshold: 1,
    timeout: 120000,
    onStateChange: stateChangeLogger
  }),
  adyen: getCircuitBreaker({
    name: 'Adyen',
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000,
    onStateChange: stateChangeLogger
  }),
  pagarme: getCircuitBreaker({
    name: 'Pagar.me',
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 30000,
    onStateChange: stateChangeLogger
  }),
  bunny: getCircuitBreaker({
    name: 'BunnyCDN',
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30000,
    onStateChange: stateChangeLogger
  }),
  resend: getCircuitBreaker({
    name: 'Resend-Email',
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000,
    onStateChange: stateChangeLogger
  }),
  firestore: getCircuitBreaker({
    name: 'Firestore',
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30000,
    onStateChange: stateChangeLogger
  }),
  rtdb: getCircuitBreaker({
    name: 'Firebase-RTDB',
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30000,
    onStateChange: stateChangeLogger
  })
};

export { CircuitBreaker };
export type { CircuitBreakerOptions, CircuitStats, CircuitState };
