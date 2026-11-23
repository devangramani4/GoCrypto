import type { AccountType, AssetDto, BalanceDto } from '@gocrypto/shared-types';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { qk } from '../lib/queryKeys';

/** Balances of one account (spot / futures / options wallet). */
export function useBalances(account: AccountType, enabled = true) {
  return useQuery({
    queryKey: qk.balances(account),
    queryFn: () => api.wallet.balances(account),
    enabled,
    staleTime: 5_000,
  });
}

export function availableOf(balances: BalanceDto[] | undefined, asset: string): string {
  return balances?.find((b) => b.asset === asset)?.available ?? '0';
}

/** Server-side user preferences (notification matrix, order confirmations…). */
export function useUserSettings() {
  return useQuery({
    queryKey: qk.userSettings,
    queryFn: () => api.users.settings(),
    staleTime: 5 * 60_000,
  });
}

/** Asset catalogue with networks, fees and limits. */
export function useAssets() {
  return useQuery({
    queryKey: qk.assets,
    queryFn: () => api.assets.list(),
    staleTime: 5 * 60_000,
  });
}

export function findAsset(assets: AssetDto[] | undefined, symbol: string | undefined): AssetDto | undefined {
  return symbol ? assets?.find((a) => a.symbol === symbol) : undefined;
}
