/** Static seed data for development / sandbox environments. */

export interface AssetSeed {
  symbol: string;
  name: string;
  decimals: number;
  stable?: boolean;
  sort: number;
}

export const ASSETS: AssetSeed[] = [
  { symbol: 'USDT', name: 'Tether USD', decimals: 6, stable: true, sort: 1 },
  { symbol: 'USDC', name: 'USD Coin', decimals: 6, stable: true, sort: 2 },
  { symbol: 'BTC', name: 'Bitcoin', decimals: 8, sort: 3 },
  { symbol: 'ETH', name: 'Ethereum', decimals: 8, sort: 4 },
  { symbol: 'SOL', name: 'Solana', decimals: 8, sort: 5 },
  { symbol: 'BNB', name: 'BNB', decimals: 8, sort: 6 },
  { symbol: 'XRP', name: 'XRP', decimals: 6, sort: 7 },
  { symbol: 'DOGE', name: 'Dogecoin', decimals: 8, sort: 8 },
  { symbol: 'ADA', name: 'Cardano', decimals: 6, sort: 9 },
  { symbol: 'LINK', name: 'Chainlink', decimals: 8, sort: 10 },
];

export const NETWORKS = [
  { code: 'BTC', name: 'Bitcoin', format: 'BTC', confirmations: 2, memo: false, explorer: 'https://mempool.space/tx/{tx}' },
  { code: 'ERC20', name: 'Ethereum (ERC20)', format: 'EVM', confirmations: 12, memo: false, explorer: 'https://etherscan.io/tx/{tx}' },
  { code: 'BEP20', name: 'BNB Smart Chain (BEP20)', format: 'EVM', confirmations: 15, memo: false, explorer: 'https://bscscan.com/tx/{tx}' },
  { code: 'TRC20', name: 'TRON (TRC20)', format: 'TRON', confirmations: 20, memo: false, explorer: 'https://tronscan.org/#/transaction/{tx}' },
  { code: 'SOL', name: 'Solana', format: 'SOLANA', confirmations: 32, memo: false, explorer: 'https://solscan.io/tx/{tx}' },
  { code: 'XRP', name: 'XRP Ledger', format: 'XRP', confirmations: 1, memo: true, explorer: 'https://xrpscan.com/tx/{tx}' },
] as const;

/** [asset, network, withdrawalFee, minWithdrawal, minDeposit, withdrawalPrecision] */
export const ASSET_NETWORKS: [string, string, string, string, string, number][] = [
  ['USDT', 'TRC20', '1', '10', '1', 6],
  ['USDT', 'ERC20', '5', '20', '5', 6],
  ['USDT', 'BEP20', '0.5', '10', '1', 6],
  ['USDT', 'SOL', '1', '10', '1', 6],
  ['USDC', 'ERC20', '5', '20', '5', 6],
  ['USDC', 'BEP20', '0.5', '10', '1', 6],
  ['USDC', 'SOL', '1', '10', '1', 6],
  ['BTC', 'BTC', '0.0002', '0.001', '0.0001', 8],
  ['BTC', 'BEP20', '0.00001', '0.0001', '0.00001', 8],
  ['ETH', 'ERC20', '0.002', '0.01', '0.001', 8],
  ['ETH', 'BEP20', '0.0001', '0.001', '0.0001', 8],
  ['SOL', 'SOL', '0.01', '0.1', '0.01', 8],
  ['BNB', 'BEP20', '0.001', '0.01', '0.001', 8],
  ['XRP', 'XRP', '0.25', '10', '1', 6],
  ['DOGE', 'BEP20', '2', '20', '5', 8],
  ['ADA', 'BEP20', '0.8', '10', '1', 6],
  ['LINK', 'ERC20', '0.5', '2', '0.1', 8],
  ['LINK', 'BEP20', '0.02', '1', '0.05', 8],
];

export interface SpotSeed {
  base: string;
  quote: string;
  tick: string;
  step: string;
  minQty: string;
  maxQty: string;
  minNotional: string;
  sort: number;
}

export const SPOT_MARKETS: SpotSeed[] = [
  { base: 'BTC', quote: 'USDT', tick: '0.01', step: '0.00001', minQty: '0.00001', maxQty: '9000', minNotional: '5', sort: 1 },
  { base: 'ETH', quote: 'USDT', tick: '0.01', step: '0.0001', minQty: '0.0001', maxQty: '100000', minNotional: '5', sort: 2 },
  { base: 'SOL', quote: 'USDT', tick: '0.01', step: '0.001', minQty: '0.001', maxQty: '1000000', minNotional: '5', sort: 3 },
  { base: 'BNB', quote: 'USDT', tick: '0.01', step: '0.001', minQty: '0.001', maxQty: '100000', minNotional: '5', sort: 4 },
  { base: 'XRP', quote: 'USDT', tick: '0.0001', step: '0.1', minQty: '0.1', maxQty: '10000000', minNotional: '5', sort: 5 },
  { base: 'DOGE', quote: 'USDT', tick: '0.00001', step: '1', minQty: '1', maxQty: '100000000', minNotional: '5', sort: 6 },
  { base: 'ADA', quote: 'USDT', tick: '0.0001', step: '0.1', minQty: '0.1', maxQty: '10000000', minNotional: '5', sort: 7 },
  { base: 'LINK', quote: 'USDT', tick: '0.001', step: '0.01', minQty: '0.01', maxQty: '1000000', minNotional: '5', sort: 8 },
  { base: 'ETH', quote: 'BTC', tick: '0.00001', step: '0.0001', minQty: '0.0001', maxQty: '100000', minNotional: '0.0001', sort: 9 },
  { base: 'USDC', quote: 'USDT', tick: '0.0001', step: '0.01', minQty: '1', maxQty: '10000000', minNotional: '5', sort: 10 },
];

export interface TierSeed {
  maxNotional: string;
  maxLeverage: number;
  mmr: string;
}

/** Maintenance amounts are derived so margin is continuous across brackets. */
export function withMaintenanceAmounts(tiers: TierSeed[]): (TierSeed & { tier: number; maintenanceAmount: string })[] {
  let cum = 0n;
  const SCALE = 10n ** 8n;
  const toUnits = (v: string) => {
    const [i, f = ''] = v.split('.');
    return BigInt(i!) * SCALE + BigInt((f + '00000000').slice(0, 8));
  };
  const fromUnits = (u: bigint) => {
    const i = u / SCALE;
    const f = (u % SCALE).toString().padStart(8, '0').replace(/0+$/, '');
    return f ? `${i}.${f}` : `${i}`;
  };
  return tiers.map((t, idx) => {
    if (idx > 0) {
      const prev = tiers[idx - 1]!;
      // cum += prevMaxNotional * (mmr - prevMmr)
      cum += (toUnits(prev.maxNotional) * (toUnits(t.mmr) - toUnits(prev.mmr))) / SCALE;
    }
    return { ...t, tier: idx + 1, maintenanceAmount: fromUnits(cum) };
  });
}

const BTC_TIERS: TierSeed[] = [
  { maxNotional: '50000', maxLeverage: 125, mmr: '0.004' },
  { maxNotional: '250000', maxLeverage: 100, mmr: '0.005' },
  { maxNotional: '1000000', maxLeverage: 50, mmr: '0.01' },
  { maxNotional: '5000000', maxLeverage: 20, mmr: '0.025' },
  { maxNotional: '20000000', maxLeverage: 10, mmr: '0.05' },
  { maxNotional: '100000000', maxLeverage: 5, mmr: '0.1' },
];
const ETH_TIERS: TierSeed[] = [
  { maxNotional: '10000', maxLeverage: 100, mmr: '0.005' },
  { maxNotional: '100000', maxLeverage: 75, mmr: '0.0065' },
  { maxNotional: '500000', maxLeverage: 50, mmr: '0.01' },
  { maxNotional: '1000000', maxLeverage: 25, mmr: '0.02' },
  { maxNotional: '50000000', maxLeverage: 10, mmr: '0.05' },
];
const ALT_TIERS: TierSeed[] = [
  { maxNotional: '5000', maxLeverage: 75, mmr: '0.0065' },
  { maxNotional: '50000', maxLeverage: 50, mmr: '0.01' },
  { maxNotional: '250000', maxLeverage: 25, mmr: '0.02' },
  { maxNotional: '10000000', maxLeverage: 10, mmr: '0.05' },
];

export interface FuturesSeed {
  underlying: string;
  tick: string;
  step: string;
  minQty: string;
  maxQty: string;
  maxLeverage: number;
  defaultLeverage: number;
  tiers: TierSeed[];
  sort: number;
}

export const FUTURES_MARKETS: FuturesSeed[] = [
  { underlying: 'BTC', tick: '0.1', step: '0.001', minQty: '0.001', maxQty: '1000', maxLeverage: 125, defaultLeverage: 20, tiers: BTC_TIERS, sort: 1 },
  { underlying: 'ETH', tick: '0.01', step: '0.001', minQty: '0.001', maxQty: '10000', maxLeverage: 100, defaultLeverage: 20, tiers: ETH_TIERS, sort: 2 },
  { underlying: 'SOL', tick: '0.01', step: '0.01', minQty: '0.01', maxQty: '100000', maxLeverage: 75, defaultLeverage: 10, tiers: ALT_TIERS, sort: 3 },
  { underlying: 'BNB', tick: '0.01', step: '0.01', minQty: '0.01', maxQty: '100000', maxLeverage: 75, defaultLeverage: 10, tiers: ALT_TIERS, sort: 4 },
  { underlying: 'XRP', tick: '0.0001', step: '0.1', minQty: '0.1', maxQty: '10000000', maxLeverage: 75, defaultLeverage: 10, tiers: ALT_TIERS, sort: 5 },
];

/** [marketType, vipTier, maker, taker] */
export const FEE_SCHEDULE: ['SPOT' | 'FUTURES' | 'OPTIONS', number, string, string][] = [
  ['SPOT', 0, '0.001', '0.001'],
  ['SPOT', 1, '0.0009', '0.001'],
  ['SPOT', 2, '0.0008', '0.0009'],
  ['SPOT', 3, '0.0006', '0.0008'],
  ['FUTURES', 0, '0.0002', '0.0005'],
  ['FUTURES', 1, '0.00016', '0.0004'],
  ['FUTURES', 2, '0.00014', '0.00035'],
  ['FUTURES', 3, '0.0001', '0.0003'],
  ['OPTIONS', 0, '0.0003', '0.0003'],
  ['OPTIONS', 1, '0.0003', '0.0003'],
  ['OPTIONS', 2, '0.00025', '0.00025'],
  ['OPTIONS', 3, '0.0002', '0.0002'],
];

export const ROLE_NAMES: Record<string, [string, string]> = {
  USER: ['User', 'Regular trading account'],
  SUPER_ADMIN: ['Super Admin', 'Full access including roles and system settings'],
  ADMIN: ['Admin', 'Platform administration'],
  FINANCE: ['Finance', 'Withdrawals, balances and financial reports'],
  TRADING_MANAGER: ['Trading Manager', 'Markets, fees and order monitoring'],
  SUPPORT: ['Support', 'Customer support and account security resets'],
  RISK_MANAGER: ['Risk Manager', 'Risk limits, freezes and surveillance'],
  VIEW_ONLY: ['View Only', 'Read-only access to the admin panel'],
};

/** Sandbox balances for system accounts: [account, asset, amount]. */
export const MARKET_MAKER_BALANCES: ['SPOT' | 'FUTURES' | 'OPTIONS', string, string][] = [
  ['SPOT', 'USDT', '2000000000'],
  ['SPOT', 'USDC', '200000000'],
  ['SPOT', 'BTC', '20000'],
  ['SPOT', 'ETH', '400000'],
  ['SPOT', 'SOL', '10000000'],
  ['SPOT', 'BNB', '2000000'],
  ['SPOT', 'XRP', '1000000000'],
  ['SPOT', 'DOGE', '10000000000'],
  ['SPOT', 'ADA', '2000000000'],
  ['SPOT', 'LINK', '100000000'],
  ['FUTURES', 'USDT', '2000000000'],
  ['OPTIONS', 'USDT', '2000000000'],
];

export const INSURANCE_FUND_BALANCES: ['SPOT' | 'FUTURES' | 'OPTIONS', string, string][] = [
  ['FUTURES', 'USDT', '500000000'],
  ['OPTIONS', 'USDT', '100000000'],
];

export const DEMO_BALANCES: ['SPOT' | 'FUTURES' | 'OPTIONS', string, string][] = [
  ['SPOT', 'USDT', '100000'],
  ['SPOT', 'BTC', '1'],
  ['SPOT', 'ETH', '10'],
  ['SPOT', 'SOL', '100'],
  ['FUTURES', 'USDT', '50000'],
  ['OPTIONS', 'USDT', '25000'],
];
