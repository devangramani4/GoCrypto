import { describe, expect, it } from 'vitest';
import {
  accountTransferSchema,
  fieldErrors,
  futuresOrderSchema,
  loginMfaSchema,
  ocoOrderSchema,
  password,
  pinCode,
  registerSchema,
  spotOrderSchema,
  withdrawSchema,
} from './index';

describe('auth schemas', () => {
  it('enforces password policy', () => {
    expect(password.safeParse('short').success).toBe(false);
    expect(password.safeParse('alllowercase123').success).toBe(false);
    expect(password.safeParse('Str0ngPassword!').success).toBe(true);
  });

  it('normalises email and requires terms', () => {
    const r = registerSchema.safeParse({ email: '  Alice@Example.COM ', password: 'Str0ngPassword!', acceptTerms: true });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe('alice@example.com');
    expect(registerSchema.safeParse({ email: 'a@b.co', password: 'Str0ngPassword!', acceptTerms: false }).success).toBe(
      false,
    );
  });

  it('rejects trivial PINs', () => {
    expect(pinCode.safeParse('111111').success).toBe(false);
    expect(pinCode.safeParse('123456').success).toBe(false);
    expect(pinCode.safeParse('480913').success).toBe(true);
  });

  it('requires exactly one MFA factor', () => {
    const token = 'x'.repeat(40);
    expect(loginMfaSchema.safeParse({ mfaToken: token, code: '123456' }).success).toBe(true);
    expect(loginMfaSchema.safeParse({ mfaToken: token }).success).toBe(false);
    expect(loginMfaSchema.safeParse({ mfaToken: token, code: '123456', backupCode: 'ABCD-EFGH' }).success).toBe(false);
  });
});

describe('order schemas', () => {
  it('accepts valid spot orders', () => {
    expect(spotOrderSchema.safeParse({ symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '50000', quantity: '0.1' }).success).toBe(true);
    expect(spotOrderSchema.safeParse({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteQuantity: '100' }).success).toBe(true);
    expect(
      spotOrderSchema.safeParse({ symbol: 'BTCUSDT', side: 'SELL', type: 'STOP_LIMIT', price: '49000', stopPrice: '49500', quantity: '1' })
        .success,
    ).toBe(true);
  });

  it('rejects malformed spot orders', () => {
    const noPrice = spotOrderSchema.safeParse({ symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', quantity: '1' });
    expect(noPrice.success).toBe(false);
    if (!noPrice.success) expect(fieldErrors(noPrice.error).price).toBe('Price is required');
    expect(spotOrderSchema.safeParse({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '1', quoteQuantity: '5' }).success).toBe(false);
    expect(spotOrderSchema.safeParse({ symbol: 'BTCUSDT', side: 'SELL', type: 'MARKET', quoteQuantity: '5' }).success).toBe(false);
    expect(spotOrderSchema.safeParse({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '-1' }).success).toBe(false);
    expect(spotOrderSchema.safeParse({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '1e3' }).success).toBe(false);
    expect(spotOrderSchema.safeParse({ symbol: 'BTCUSDT', side: 'BUY', type: 'STOP_MARKET', quantity: '1', postOnly: true, stopPrice: '1' }).success).toBe(false);
  });

  it('validates futures order flags', () => {
    expect(futuresOrderSchema.safeParse({ symbol: 'BTCUSDT-PERP', side: 'SELL', type: 'STOP_MARKET', stopPrice: '45000', closePosition: true }).success).toBe(true);
    expect(futuresOrderSchema.safeParse({ symbol: 'BTCUSDT-PERP', side: 'SELL', type: 'LIMIT', price: '1', quantity: '1', closePosition: true }).success).toBe(false);
    expect(futuresOrderSchema.safeParse({ symbol: 'BTCUSDT-PERP', side: 'BUY', type: 'MARKET', quantity: '0.5', reduceOnly: true }).success).toBe(true);
  });

  it('validates OCO orders', () => {
    expect(ocoOrderSchema.safeParse({ symbol: 'ETHUSDT', side: 'SELL', quantity: '1', price: '4000', stopPrice: '3000', stopLimitPrice: '2990' }).success).toBe(true);
  });
});

describe('wallet schemas', () => {
  it('requires idempotency keys for withdrawals', () => {
    const base = { asset: 'USDT', network: 'TRC20', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', amount: '10' };
    expect(withdrawSchema.safeParse(base).success).toBe(false);
    expect(withdrawSchema.safeParse({ ...base, idempotencyKey: 'abcdef123456' }).success).toBe(true);
  });

  it('rejects transfers to the same account', () => {
    expect(accountTransferSchema.safeParse({ asset: 'USDT', amount: '1', from: 'SPOT', to: 'SPOT' }).success).toBe(false);
    expect(accountTransferSchema.safeParse({ asset: 'USDT', amount: '1', from: 'SPOT', to: 'FUTURES' }).success).toBe(true);
  });
});
