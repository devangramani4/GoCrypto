import type { Core } from '../core';
import { randomDigits, safeEqual, sha256Hex } from '../crypto';
import { AppError } from '../errors';
import { key } from '../redis';

export type OtpPurpose = 'email_verify' | 'password_reset' | 'phone_verify' | 'withdrawal' | 'transfer';

/**
 * One-time codes stored hashed in Redis with TTL, resend cooldown and an attempt budget.
 * Codes are never persisted in plain text.
 */
export class OtpService {
  constructor(private readonly core: Core) {}

  async issue(purpose: OtpPurpose, subject: string, opts: { ttlSec?: number; cooldownSec?: number } = {}): Promise<string> {
    const cooldown = await this.core.redis.main.set(key('otpcd', purpose, subject), '1', 'EX', opts.cooldownSec ?? 60, 'NX');
    if (cooldown !== 'OK') throw new AppError('OTP_RATE_LIMITED', 'Please wait before requesting another code');
    const code = randomDigits(6);
    const k = key('otp', purpose, subject);
    await this.core.redis.main
      .multi()
      .hset(k, 'h', sha256Hex(`${purpose}:${subject}:${code}`), 'a', '0')
      .expire(k, opts.ttlSec ?? 900)
      .exec();
    if (!this.core.config.isProduction && this.core.config.EMAIL_CONFIG === 'log') {
      // Development convenience only: emails/SMS are not delivered in "log" mode.
      this.core.log.info({ purpose, subject, devOtp: code }, '[dev] one-time code issued');
    }
    return code;
  }

  /** Verify (and by default consume) a code. Five wrong attempts invalidate it. */
  async verify(purpose: OtpPurpose, subject: string, code: string, opts: { consume?: boolean } = {}): Promise<void> {
    const k = key('otp', purpose, subject);
    const data = await this.core.redis.main.hgetall(k);
    if (!data.h) throw new AppError('OTP_EXPIRED', 'The code has expired. Request a new one.');
    const attempts = Number(data.a ?? 0);
    if (attempts >= 5) {
      await this.core.redis.main.del(k);
      throw new AppError('OTP_EXPIRED', 'Too many attempts. Request a new code.');
    }
    if (!safeEqual(data.h, sha256Hex(`${purpose}:${subject}:${code}`))) {
      await this.core.redis.main.hincrby(k, 'a', 1);
      throw new AppError('INVALID_OTP', 'Invalid code');
    }
    if (opts.consume !== false) await this.core.redis.main.del(k);
  }
}
