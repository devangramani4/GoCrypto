import type { Decimal } from '@gocrypto/trading-utils';

/** Heuristic withdrawal risk scoring (owned by the risk engine, shared with wallet operations). */
export interface WithdrawalRiskInput {
  amountUsd: Decimal;
  reviewThresholdUsd: Decimal;
  newAddress: boolean;
  newAddressReview: boolean;
  accountAgeDays: number;
  twoFactorEnabled: boolean;
  balanceUsd: Decimal;
  withdrawalsLast24h: number;
  kycLevel: number;
}

export interface WithdrawalRiskResult {
  score: number;
  flags: string[];
  requiresReview: boolean;
}

/** Heuristic withdrawal risk scoring. Anything >= 50 goes to manual review. */
export function scoreWithdrawal(i: WithdrawalRiskInput): WithdrawalRiskResult {
  const flags: string[] = [];
  let score = 0;
  if (i.amountUsd.gte(i.reviewThresholdUsd)) {
    score += 50;
    flags.push('LARGE_AMOUNT');
  }
  if (i.newAddress) {
    score += i.newAddressReview ? 20 : 10;
    flags.push('NEW_ADDRESS');
  }
  if (i.accountAgeDays < 7) {
    score += 15;
    flags.push('NEW_ACCOUNT');
  }
  if (!i.twoFactorEnabled) {
    score += 10;
    flags.push('NO_2FA');
  }
  if (i.balanceUsd.gt(0) && i.amountUsd.div(i.balanceUsd).gte('0.9')) {
    score += 10;
    flags.push('FULL_BALANCE');
  }
  if (i.withdrawalsLast24h >= 5) {
    score += 15;
    flags.push('VELOCITY');
  }
  if (i.kycLevel === 0 && i.amountUsd.gte(1000)) {
    score += 10;
    flags.push('LOW_KYC');
  }
  return { score, flags, requiresReview: score >= 50 };
}
