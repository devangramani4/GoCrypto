import nodemailer, { type Transporter } from 'nodemailer';
import { type AppConfig, loadConfig } from '../config';
import { getLogger } from '../logger';
import { FcmClient, parseServiceAccount } from './fcm';
import type { EmailJob } from '../queues';

const TEMPLATES: Record<string, { subject?: string; html: (v: Record<string, string | number | null>) => string }> = {
  verify_email: {
    html: (v) =>
      `<p>Your GoCrypto email verification code is:</p><h2 style="letter-spacing:4px">${v.code}</h2><p>The code expires in 15 minutes.</p>`,
  },
  password_reset: {
    html: (v) =>
      `<p>We received a request to reset your password.</p><h2 style="letter-spacing:4px">${v.code}</h2><p>If this wasn't you, secure your account immediately.</p>`,
  },
  withdrawal_code: {
    html: (v) =>
      `<p>Confirm your withdrawal of <b>${v.amount} ${v.asset}</b> to <code>${v.address}</code> with code:</p><h2 style="letter-spacing:4px">${v.code}</h2>`,
  },
  new_device: {
    html: (v) =>
      `<p>New sign-in to your GoCrypto account.</p><p>Device: ${v.device}<br/>IP: ${v.ip}<br/>Time: ${v.time}</p><p>If this wasn't you, change your password and contact support.</p>`,
  },
  notification: {
    html: (v) => `<p>${v.body}</p>`,
  },
};

function render(job: EmailJob): string {
  const tpl = TEMPLATES[job.template] ?? TEMPLATES.notification!;
  const body = tpl.html(job.vars);
  const phishing = job.antiPhishingCode
    ? `<p style="color:#888;font-size:12px">Anti-phishing code: <b>${escapeHtml(job.antiPhishingCode)}</b></p>`
    : '';
  return `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;background:#0b0e11;color:#eaecef;padding:24px">
<div style="max-width:520px;margin:auto;background:#161a1e;border-radius:12px;padding:24px">
<h1 style="color:#f0b90b;font-size:20px;margin:0 0 16px">GoCrypto</h1>${phishing}${body}
<p style="color:#888;font-size:12px;margin-top:24px">GoCrypto will never ask for your password, PIN or 2FA codes.</p></div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export class EmailChannel {
  private transporter: Transporter | null = null;
  private readonly mode: 'log' | 'smtp';

  constructor() {
    const cfg = loadConfig().EMAIL_CONFIG.trim();
    if (cfg === 'log' || cfg === '') {
      this.mode = 'log';
      return;
    }
    this.mode = 'smtp';
    if (cfg.startsWith('{')) {
      const o = JSON.parse(cfg) as { host: string; port: number; secure?: boolean; user?: string; pass?: string };
      this.transporter = nodemailer.createTransport({
        host: o.host,
        port: o.port,
        secure: o.secure ?? o.port === 465,
        auth: o.user ? { user: o.user, pass: o.pass ?? '' } : undefined,
      });
    } else {
      this.transporter = nodemailer.createTransport(cfg);
    }
  }

  async send(job: EmailJob): Promise<void> {
    const html = render(job);
    if (this.mode === 'log' || !this.transporter) {
      getLogger().info(
        { to: job.to, subject: job.subject, template: job.template },
        '[email:log] message suppressed (EMAIL_CONFIG=log)',
      );
      return;
    }
    await this.transporter.sendMail({ from: loadConfig().EMAIL_FROM, to: job.to, subject: job.subject, html });
  }
}

export class SmsChannel {
  async send(to: string, body: string): Promise<void> {
    const cfg = loadConfig().SMS_CONFIG;
    if (cfg === 'log' || !cfg) {
      getLogger().info({ to: to.replace(/\d(?=\d{4})/g, '*') }, '[sms:log] message suppressed (SMS_CONFIG=log)');
      return;
    }
    // Provider integration point (Twilio, MessageBird, …). Configure SMS_CONFIG as JSON.
    const o = JSON.parse(cfg) as { provider: string; url: string; token: string; from: string };
    const res = await fetch(o.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: o.from, to, body }),
    });
    if (!res.ok) throw new Error(`SMS provider responded ${res.status}`);
  }
}

export interface PushResult {
  /** Devices FCM accepted the notification for. */
  sent: number;
  /** Tokens FCM reported as no longer valid — the caller should stop sending to them. */
  invalidTokens: string[];
  /** Deliveries that failed because FCM was unavailable or rate limited. */
  retryable: number;
}

/**
 * Push notifications through Firebase Cloud Messaging (Android, and iOS via APNs). PUSH_PROVIDER=log
 * only logs (development). Tokens registered with other providers are not deliverable and skipped.
 */
export class PushChannel {
  private fcm: FcmClient | null = null;

  constructor(
    private readonly cfg: Pick<AppConfig, 'PUSH_PROVIDER' | 'FCM_SERVICE_ACCOUNT'> = loadConfig(),
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async send(
    tokens: { token: string; provider: string | null }[],
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<PushResult> {
    if (this.cfg.PUSH_PROVIDER === 'log' || tokens.length === 0) {
      getLogger().info({ devices: tokens.length, title }, '[push:log] notification suppressed (PUSH_PROVIDER=log)');
      return { sent: 0, invalidTokens: [], retryable: 0 };
    }
    const fcmTokens = tokens.filter((t) => t.provider === 'FCM').map((t) => t.token);
    if (fcmTokens.length < tokens.length) {
      getLogger().debug({ skipped: tokens.length - fcmTokens.length }, 'push tokens from other providers skipped');
    }
    if (fcmTokens.length === 0) return { sent: 0, invalidTokens: [], retryable: 0 };
    this.fcm ??= new FcmClient(parseServiceAccount(this.cfg.FCM_SERVICE_ACCOUNT), this.fetchImpl);
    const fcm = this.fcm;
    const outcomes = await Promise.all(
      fcmTokens.map(async (token) => [token, await fcm.send(token, { title, body, data })] as const),
    );
    const result: PushResult = {
      sent: outcomes.filter(([, o]) => o === 'sent').length,
      invalidTokens: outcomes.filter(([, o]) => o === 'invalid-token').map(([t]) => t),
      retryable: outcomes.filter(([, o]) => o === 'retryable').length,
    };
    if (result.sent < fcmTokens.length) {
      getLogger().warn(
        {
          devices: fcmTokens.length,
          sent: result.sent,
          invalid: result.invalidTokens.length,
          retryable: result.retryable,
        },
        'some push notifications were not delivered',
      );
    }
    return result;
  }
}
