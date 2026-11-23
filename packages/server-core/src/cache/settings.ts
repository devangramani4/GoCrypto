import type { Database, Executor } from '../db/database';
import { parseJson } from '../db/database';

/** Defaults for every runtime-tunable setting (overridable via system_settings / admin panel). */
export const DEFAULT_SETTINGS = {
  /** Daily withdrawal limit in USD by KYC level. */
  'withdrawal.daily_limit_usd': { '0': '2000', '1': '50000', '2': '500000', '3': '5000000' } as Record<string, string>,
  /** Withdrawals at or above this USD value always require manual review. */
  'withdrawal.review_threshold_usd': '10000',
  /** Hours a newly used address must wait (0 disables the rule; flagged for review instead). */
  'withdrawal.new_address_review': true,
  /** Withdrawal lock after security changes (password / 2FA / PIN reset). */
  'withdrawal.security_lock_hours': 24,
  'withdrawal.require_email_code': true,
  'risk.max_open_orders': 200,
  'risk.max_order_notional_usd': '5000000',
  'risk.daily_order_notional_usd': '100000000',
  'risk.liquidation_warning_ratio': '0.8',
  'security.max_login_attempts': 5,
  'security.login_lock_minutes': 15,
  'security.pin_max_attempts': 5,
  'security.pin_lock_minutes': 30,
  'sandbox.max_simulated_deposit_usd': '1000000',
  'maintenance.trading_halted': false,
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof DEFAULT_SETTINGS)[K] extends string
  ? string
  : (typeof DEFAULT_SETTINGS)[K] extends boolean
    ? boolean
    : (typeof DEFAULT_SETTINGS)[K] extends number
      ? number
      : (typeof DEFAULT_SETTINGS)[K];

export class SettingsService {
  private values = new Map<string, unknown>();
  private loadedAt = 0;

  constructor(private readonly db: Database) {}

  async load(): Promise<void> {
    const rows = await this.db.query<{ setting_key: string; value: unknown }>('SELECT setting_key, value FROM system_settings');
    const next = new Map<string, unknown>();
    for (const r of rows) next.set(r.setting_key, parseJson(r.value, null));
    this.values = next;
    this.loadedAt = Date.now();
  }

  get<K extends SettingKey>(k: K): SettingValue<K> {
    const v = this.values.get(k);
    return (v === undefined || v === null ? DEFAULT_SETTINGS[k] : v) as SettingValue<K>;
  }

  all(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = this.get(k as SettingKey);
    return out;
  }

  isKnown(k: string): k is SettingKey {
    return k in DEFAULT_SETTINGS;
  }

  async set(exec: Executor, k: SettingKey, value: unknown, updatedBy: string | null): Promise<void> {
    await exec.execute(
      `INSERT INTO system_settings (setting_key, value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
      [k, JSON.stringify(value), updatedBy],
    );
    this.values.set(k, value);
  }

  get lastLoadedAt(): number {
    return this.loadedAt;
  }
}
