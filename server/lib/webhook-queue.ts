type Priority = 'critical' | 'high' | 'normal' | 'low';

type WebhookPayload = {
  id: string;
  source: string;
  event: string;
  data: any;
  receivedAt: number;
  retries: number;
  priority: Priority;
  lastError?: string;
  processedAt?: number;
};

type QueueProcessor = (payload: WebhookPayload) => Promise<void>;

const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3
};

const SOURCE_PRIORITY: Record<string, Priority> = {
  'efibank': 'critical',
  'stripe': 'critical',
  'woovi': 'critical',
  'adyen': 'critical',
  'pagarme': 'critical',
  'witetec': 'critical',
  'webhook-dispatcher': 'high',
  'utmify': 'low',
  'notazz': 'normal',
};

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

class WebhookQueue {
  private queues: Map<Priority, WebhookPayload[]> = new Map([
    ['critical', []],
    ['high', []],
    ['normal', []],
    ['low', []]
  ]);
  private dlq: WebhookPayload[] = [];
  private processor: QueueProcessor | null = null;
  private namedProcessors = new Map<string, QueueProcessor>();
  private maxRetries = 5;
  private concurrency = 5;
  private activeWorkers = 0;
  private processedCount = 0;
  private failedCount = 0;
  private retriedCount = 0;
  private rateLimitedCount = 0;
  private dlqCount = 0;
  private startTime = Date.now();
  private rateLimits = new Map<string, RateLimitEntry>();
  private rateLimitWindow = 60000;
  private rateLimitMax = 100;
  private maxDlqSize = 500;
  private maxQueueSize = 10000;
  private processingTimes: number[] = [];
  private draining = false;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 120000);
  }

  setProcessor(fn: QueueProcessor) {
    this.processor = fn;
  }

  registerProcessor(source: string, fn: QueueProcessor) {
    this.namedProcessors.set(source, fn);
  }

  setConcurrency(n: number) {
    this.concurrency = Math.max(1, Math.min(n, 20));
  }

  setRateLimit(maxPerMinute: number) {
    this.rateLimitMax = maxPerMinute;
  }

  enqueue(source: string, event: string, data: any, priority?: Priority): string {
    if (this.draining) {
      console.warn(`[WebhookQueue] Queue draining, rejecting: ${source}/${event}`);
      return '';
    }

    const resolvedPriority = priority || SOURCE_PRIORITY[source] || 'normal';

    if (this.isRateLimited(source)) {
      this.rateLimitedCount++;
      console.warn(`[WebhookQueue] Rate limited: ${source} (>${this.rateLimitMax}/min)`);
      return '';
    }

    const totalSize = this.getTotalPending();
    if (totalSize >= this.maxQueueSize) {
      console.error(`[WebhookQueue] Queue full (${totalSize}/${this.maxQueueSize}), rejecting: ${source}/${event}`);
      return '';
    }

    const id = `wq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const payload: WebhookPayload = {
      id,
      source,
      event,
      data,
      receivedAt: Date.now(),
      retries: 0,
      priority: resolvedPriority
    };

    const queue = this.queues.get(resolvedPriority)!;
    queue.push(payload);
    this.trackRateLimit(source);

    console.log(`[WebhookQueue] Enqueued: ${source}/${event} [${resolvedPriority}] (id: ${id}, queue: ${this.getTotalPending()})`);

    setImmediate(() => this.startProcessing());
    return id;
  }

  private isRateLimited(source: string): boolean {
    const entry = this.rateLimits.get(source);
    if (!entry) return false;
    if (Date.now() - entry.windowStart > this.rateLimitWindow) {
      this.rateLimits.delete(source);
      return false;
    }
    return entry.count >= this.rateLimitMax;
  }

  private trackRateLimit(source: string): void {
    const entry = this.rateLimits.get(source);
    const now = Date.now();
    if (!entry || now - entry.windowStart > this.rateLimitWindow) {
      this.rateLimits.set(source, { count: 1, windowStart: now });
    } else {
      entry.count++;
    }
  }

  private getNextPayload(): WebhookPayload | null {
    for (const priority of ['critical', 'high', 'normal', 'low'] as Priority[]) {
      const queue = this.queues.get(priority)!;
      if (queue.length > 0) {
        return queue.shift()!;
      }
    }
    return null;
  }

  private getTotalPending(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.length;
    }
    return total;
  }

  private async startProcessing() {
    const resolvedProcessor = (payload: WebhookPayload) => {
      const named = this.namedProcessors.get(payload.source);
      if (named) return named(payload);
      if (this.processor) return this.processor(payload);
      return Promise.reject(new Error(`No processor for source: ${payload.source}`));
    };

    if (!this.processor && this.namedProcessors.size === 0) return;
    if (this.activeWorkers >= this.concurrency) return;

    while (this.getTotalPending() > 0 && this.activeWorkers < this.concurrency) {
      const payload = this.getNextPayload();
      if (!payload) break;

      this.activeWorkers++;
      this.processOne(payload, resolvedProcessor).finally(() => {
        this.activeWorkers--;
        if (this.getTotalPending() > 0) {
          setImmediate(() => this.startProcessing());
        }
      });
    }
  }

  private async processOne(payload: WebhookPayload, processorFn: QueueProcessor) {
    const startTime = Date.now();
    try {
      await processorFn(payload);
      this.processedCount++;
      const elapsed = Date.now() - startTime;
      this.processingTimes.push(elapsed);
      if (this.processingTimes.length > 100) this.processingTimes.shift();
      console.log(`[WebhookQueue] Done: ${payload.source}/${payload.event} ${payload.id} (${elapsed}ms)`);
    } catch (error: any) {
      payload.retries++;
      payload.lastError = error.message || String(error);

      if (payload.retries < this.maxRetries) {
        this.retriedCount++;
        const baseDelay = payload.priority === 'critical' ? 500 : 1000;
        const delay = Math.min(baseDelay * Math.pow(2, payload.retries), 30000);
        console.warn(`[WebhookQueue] Retry ${payload.retries}/${this.maxRetries}: ${payload.id} [${payload.priority}] - ${error.message} (next in ${delay}ms)`);
        setTimeout(() => {
          const queue = this.queues.get(payload.priority)!;
          if (payload.priority === 'critical') {
            queue.unshift(payload);
          } else {
            queue.push(payload);
          }
          this.startProcessing();
        }, delay);
      } else {
        this.failedCount++;
        this.dlqCount++;
        payload.processedAt = Date.now();
        this.dlq.push(payload);
        if (this.dlq.length > this.maxDlqSize) {
          this.dlq.shift();
        }
        console.error(`[WebhookQueue] DLQ: ${payload.id} [${payload.priority}] after ${this.maxRetries} attempts - ${error.message}`);
      }
    }
  }

  getPendingCount(): number {
    return this.getTotalPending();
  }

  getActiveCount(): number {
    return this.activeWorkers;
  }

  getDlq(): WebhookPayload[] {
    return [...this.dlq];
  }

  getDlqCount(): number {
    return this.dlq.length;
  }

  retryDlqItem(id: string): boolean {
    const index = this.dlq.findIndex(p => p.id === id);
    if (index === -1) return false;
    const payload = this.dlq.splice(index, 1)[0];
    payload.retries = 0;
    payload.lastError = undefined;
    const queue = this.queues.get(payload.priority)!;
    queue.push(payload);
    this.startProcessing();
    return true;
  }

  retryAllDlq(): number {
    const count = this.dlq.length;
    const items = this.dlq.splice(0);
    for (const payload of items) {
      payload.retries = 0;
      payload.lastError = undefined;
      const queue = this.queues.get(payload.priority)!;
      queue.push(payload);
    }
    if (count > 0) this.startProcessing();
    return count;
  }

  clearDlq(): number {
    const count = this.dlq.length;
    this.dlq.length = 0;
    return count;
  }

  getStats() {
    const pendingByPriority: Record<string, number> = {};
    for (const [priority, queue] of this.queues.entries()) {
      pendingByPriority[priority] = queue.length;
    }

    const avgProcessingTime = this.processingTimes.length > 0
      ? Math.round(this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length)
      : 0;

    return {
      pending: this.getTotalPending(),
      pendingByPriority,
      active: this.activeWorkers,
      processed: this.processedCount,
      failed: this.failedCount,
      retried: this.retriedCount,
      rateLimited: this.rateLimitedCount,
      dlqSize: this.dlq.length,
      dlqTotal: this.dlqCount,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      concurrency: this.concurrency,
      avgProcessingTimeMs: avgProcessingTime,
      rateLimitMax: this.rateLimitMax,
      draining: this.draining,
      registeredProcessors: Array.from(this.namedProcessors.keys()),
      throughput: this.processedCount > 0
        ? `${((this.processedCount / ((Date.now() - this.startTime) / 1000)) * 60).toFixed(1)}/min`
        : '0/min'
    };
  }

  async drain(timeoutMs = 30000): Promise<void> {
    this.draining = true;
    console.log(`[WebhookQueue] Draining... (pending: ${this.getTotalPending()}, active: ${this.activeWorkers})`);
    const start = Date.now();
    while ((this.getTotalPending() > 0 || this.activeWorkers > 0) && (Date.now() - start) < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const remaining = this.getTotalPending() + this.activeWorkers;
    if (remaining > 0) {
      console.warn(`[WebhookQueue] Drain timeout: ${remaining} items remaining`);
    } else {
      console.log(`[WebhookQueue] Drain complete`);
    }
  }

  cleanup(): void {
    const now = Date.now();
    for (const [source, entry] of this.rateLimits.entries()) {
      if (now - entry.windowStart > this.rateLimitWindow * 2) {
        this.rateLimits.delete(source);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

export const webhookQueue = new WebhookQueue();
export type { WebhookPayload, Priority, QueueProcessor };
