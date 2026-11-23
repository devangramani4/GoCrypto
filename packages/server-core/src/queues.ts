import { type JobsOptions, Queue } from 'bullmq';
import { loadConfig } from './config';

export const QUEUE_NAMES = {
  notifications: 'notifications',
  withdrawals: 'withdrawals',
  deposits: 'deposits',
  maintenance: 'maintenance',
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface EmailJob {
  to: string;
  subject: string;
  /** Template name rendered by the worker. */
  template: string;
  vars: Record<string, string | number | null>;
  antiPhishingCode?: string | null;
}

export interface PushJob {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface SmsJob {
  to: string;
  body: string;
}

/** BullMQ connection options from REDIS_URL (BullMQ requires maxRetriesPerRequest = null). */
export function bullConnection(url = loadConfig().REDIS_URL) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export const BULL_PREFIX = 'gc:bull';

const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/** Producer side of background job queues (consumers live in services/workers). */
export class QueueService {
  private readonly queues = new Map<QueueName, Queue>();

  get(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: bullConnection(), prefix: BULL_PREFIX, defaultJobOptions: DEFAULT_JOB_OPTS });
      this.queues.set(name, q);
    }
    return q;
  }

  async add<T>(name: QueueName, jobName: string, data: T, opts: JobsOptions = {}): Promise<void> {
    await this.get(name).add(jobName, data, opts);
  }

  email(job: EmailJob): Promise<void> {
    return this.add(QUEUE_NAMES.notifications, 'email', job);
  }

  push(job: PushJob): Promise<void> {
    return this.add(QUEUE_NAMES.notifications, 'push', job);
  }

  sms(job: SmsJob): Promise<void> {
    return this.add(QUEUE_NAMES.notifications, 'sms', job);
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }
}
