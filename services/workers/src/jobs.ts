import { type Job, Worker } from 'bullmq';
import {
  BULL_PREFIX,
  type Core,
  EmailChannel,
  type EmailJob,
  PushChannel,
  type PushJob,
  QUEUE_NAMES,
  SmsChannel,
  type SmsJob,
  bullConnection,
  metrics,
} from '@gocrypto/server-core';

/** BullMQ consumers (horizontally scalable; jobs are retried with exponential backoff). */
export function startJobWorkers(core: Core): Worker[] {
  const email = new EmailChannel();
  const sms = new SmsChannel();
  const push = new PushChannel();
  const connection = bullConnection();
  const wrap = (queue: string, fn: (job: Job) => Promise<void>) => async (job: Job) => {
    try {
      await fn(job);
      metrics.jobsTotal.inc({ queue, result: 'ok' });
    } catch (e) {
      metrics.jobsTotal.inc({ queue, result: 'error' });
      core.log.warn({ err: e, queue, job: job.name, attempt: job.attemptsMade }, 'job failed');
      throw e;
    }
  };

  const notifications = new Worker(
    QUEUE_NAMES.notifications,
    wrap(QUEUE_NAMES.notifications, async (job) => {
      if (job.name === 'email') await email.send(job.data as EmailJob);
      else if (job.name === 'sms') await sms.send((job.data as SmsJob).to, (job.data as SmsJob).body);
      else if (job.name === 'push') {
        const data = job.data as PushJob;
        const tokens = await core.db.query<{ push_token: string; push_provider: string | null }>(
          'SELECT push_token, push_provider FROM user_devices WHERE user_id = ? AND push_token IS NOT NULL AND revoked_at IS NULL',
          [data.userId],
        );
        const result = await push.send(
          tokens.map((t) => ({ token: t.push_token, provider: t.push_provider })),
          data.title,
          data.body,
          data.data,
        );
        if (result.invalidTokens.length) {
          // App uninstalled or token rotated: stop sending to it (the app registers its new token itself).
          await core.db.execute(
            `UPDATE user_devices SET push_token = NULL, push_provider = NULL
              WHERE user_id = ? AND push_token IN (${result.invalidTokens.map(() => '?').join(', ')})`,
            [data.userId, ...result.invalidTokens],
          );
        }
        // Retry (with backoff) only when FCM was unavailable for every device, so devices that already
        // received the notification never get it twice.
        if (result.sent === 0 && result.retryable > 0) throw new Error('FCM unavailable; push will be retried');
      }
    }),
    { connection, prefix: BULL_PREFIX, concurrency: 10 },
  );

  const deposits = new Worker(
    QUEUE_NAMES.deposits,
    wrap(QUEUE_NAMES.deposits, async (job) => {
      const { depositId } = job.data as { depositId: string };
      const res = await core.walletOps.confirmDeposit(depositId);
      if (res.status === 'CONFIRMING') {
        // Sandbox chain simulation: one confirmation every ~2 seconds.
        const n =
          Number(
            String(job.id ?? '')
              .split('-')
              .pop() ?? 1,
          ) + 1;
        await core.queues.add(
          QUEUE_NAMES.deposits,
          'confirm',
          { depositId },
          { delay: 2000, jobId: `dep-${depositId}-${n}` },
        );
      }
    }),
    { connection, prefix: BULL_PREFIX, concurrency: 5 },
  );

  const withdrawals = new Worker(
    QUEUE_NAMES.withdrawals,
    wrap(QUEUE_NAMES.withdrawals, async (job) => {
      const { withdrawalId } = job.data as { withdrawalId: string };
      if (core.config.isSandbox) await new Promise((r) => setTimeout(r, 2500));
      const status = await core.walletOps.processWithdrawal(withdrawalId);
      core.log.info({ withdrawalId, status }, 'withdrawal processed');
    }),
    { connection, prefix: BULL_PREFIX, concurrency: 2 },
  );

  for (const w of [notifications, deposits, withdrawals]) {
    w.on('error', (err) => core.log.warn({ err: err.message }, 'worker error'));
  }
  return [notifications, deposits, withdrawals];
}
