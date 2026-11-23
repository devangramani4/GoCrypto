import type { MarketDto, RiskTierDto } from '@gocrypto/shared-types';
import { D } from '@gocrypto/trading-utils';
import { Alert, Button, IconButton, TextInput } from '@gocrypto/ui';
import { adminRiskTiersSchema } from '@gocrypto/validation';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AppModal } from '../../components/AppModal';
import { useApi } from '../../lib/ApiContext';
import { errorMessage } from '../../lib/errors';
import { dec, fmtAmount, fmtRate } from '../../lib/format';
import { useOpenEffect } from '../../lib/hooks';
import { useCan } from '../../lib/permissions';
import { qk } from '../../lib/queryKeys';
import { useAction } from '../../lib/useAction';

interface TierRow {
  key: number;
  maxNotional: string;
  maxLeverage: string;
  maintenanceMarginRate: string;
  maintenanceAmount: string;
}

let rowSeq = 0;
const toRow = (t: RiskTierDto): TierRow => ({
  key: ++rowSeq,
  maxNotional: t.maxNotional,
  maxLeverage: String(t.maxLeverage),
  maintenanceMarginRate: t.maintenanceMarginRate,
  maintenanceAmount: t.maintenanceAmount,
});

/**
 * Maintenance amounts that keep maintenance margin continuous across brackets:
 * amount[i] = amount[i-1] + maxNotional[i-1] × (mmr[i] − mmr[i-1]).
 */
export function continuousMaintenanceAmounts(rows: Pick<TierRow, 'maxNotional' | 'maintenanceMarginRate'>[]): string[] | null {
  const out: string[] = [];
  let cum = D(0);
  for (let i = 0; i < rows.length; i++) {
    const mmr = dec(rows[i]?.maintenanceMarginRate);
    if (!mmr) return null;
    if (i > 0) {
      const prevNotional = dec(rows[i - 1]?.maxNotional);
      const prevMmr = dec(rows[i - 1]?.maintenanceMarginRate);
      if (!prevNotional || !prevMmr) return null;
      cum = cum.plus(prevNotional.mul(mmr.minus(prevMmr)));
    }
    out.push(cum.toFixed());
  }
  return out;
}

export function validateTiers(rows: TierRow[]): { rowErrors: Record<number, Partial<Record<keyof TierRow, string>>>; general: string[] } {
  const rowErrors: Record<number, Partial<Record<keyof TierRow, string>>> = {};
  const general: string[] = [];
  const payload = rows.map((r, i) => ({
    tier: i + 1,
    maxNotional: r.maxNotional.trim(),
    maxLeverage: r.maxLeverage.trim() === '' ? Number.NaN : Number(r.maxLeverage),
    maintenanceMarginRate: r.maintenanceMarginRate.trim(),
    maintenanceAmount: r.maintenanceAmount.trim(),
  }));
  const parsed = adminRiskTiersSchema.safeParse({ tiers: payload });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [root, idx, field] = issue.path;
      if (root === 'tiers' && typeof idx === 'number' && typeof field === 'string') {
        const row = rows[idx];
        if (row) rowErrors[row.key] = { ...rowErrors[row.key], [field]: issue.message };
      } else general.push(issue.message);
    }
  }
  for (let i = 1; i < rows.length; i++) {
    const prev = dec(rows[i - 1]?.maxNotional);
    const cur = dec(rows[i]?.maxNotional);
    const row = rows[i];
    if (prev && cur && row && cur.lte(prev)) rowErrors[row.key] = { ...rowErrors[row.key], maxNotional: 'Must exceed the previous tier' };
  }
  return { rowErrors, general };
}

export function RiskTiersDialog({ market, onClose }: { market: MarketDto | null; onClose: () => void }) {
  const client = useApi();
  const qc = useQueryClient();
  const can = useCan();
  const editable = can('risk.write');
  const [rows, setRows] = useState<TierRow[]>([]);
  const [submitted, setSubmitted] = useState(false);

  useOpenEffect(market !== null, () => {
    setRows((market?.futures?.riskTiers ?? []).slice().sort((a, b) => a.tier - b.tier).map(toRow));
    setSubmitted(false);
  });

  const action = useAction<{ id: number; tiers: unknown[] }, MarketDto>({
    mutationFn: ({ id, tiers }) => client.admin.setRiskTiers(id, tiers),
    success: (m) => `Risk tiers saved for ${m.symbol}`,
    invalidate: [qk.markets],
    errorToast: false,
    onSuccess: (m) => {
      qc.setQueryData<MarketDto[]>(qk.markets, (list) => list?.map((x) => (x.id === m.id ? m : x)));
      onClose();
    },
  });

  if (!market) return null;
  const { rowErrors, general } = validateTiers(rows);
  const hasErrors = Object.keys(rowErrors).length > 0 || general.length > 0;
  const update = (key: number, patch: Partial<TierRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const leverageIncreases = rows.some((r, i) => i > 0 && Number(r.maxLeverage) > Number(rows[i - 1]?.maxLeverage));

  const save = () => {
    setSubmitted(true);
    if (hasErrors || !rows.length) return;
    action.mutate({
      id: market.id,
      tiers: rows.map((r, i) => ({
        tier: i + 1,
        maxNotional: r.maxNotional.trim(),
        maxLeverage: Number(r.maxLeverage),
        maintenanceMarginRate: r.maintenanceMarginRate.trim(),
        maintenanceAmount: r.maintenanceAmount.trim(),
      })),
    });
  };

  const addTier = () => {
    const last = rows[rows.length - 1];
    const nextNotional = last && dec(last.maxNotional) ? D(last.maxNotional).mul(2).toFixed() : '50000';
    const nextLev = last ? String(Math.max(1, Math.floor(Number(last.maxLeverage) / 2) || 1)) : String(market.futures?.maxLeverage ?? 20);
    const nextMmr = last && dec(last.maintenanceMarginRate) ? D(last.maintenanceMarginRate).mul(2).toFixed() : '0.005';
    setRows((rs) => [...rs, { key: ++rowSeq, maxNotional: nextNotional, maxLeverage: nextLev, maintenanceMarginRate: nextMmr, maintenanceAmount: '0' }]);
  };

  const recalc = () => {
    const amounts = continuousMaintenanceAmounts(rows);
    if (amounts) setRows((rs) => rs.map((r, i) => ({ ...r, maintenanceAmount: amounts[i] ?? r.maintenanceAmount })));
  };

  const err = (key: number, field: keyof TierRow) => (submitted ? (rowErrors[key]?.[field] ?? null) : null);

  return (
    <AppModal
      open
      wide
      title={`Risk tiers · ${market.symbol}`}
      onClose={() => {
        if (action.isPending) return;
        action.reset();
        onClose();
      }}
      footer={
        <>
          {editable && (
            <>
              <Button size="sm" icon="plus" onClick={addTier} disabled={rows.length >= 20} style={{ marginRight: 'auto' }}>
                Add tier
              </Button>
              <Button size="sm" variant="ghost" icon="refresh" onClick={recalc} title="Derive maintenance amounts so margin is continuous across tiers">
                Recalculate amounts
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={onClose} disabled={action.isPending}>
            {editable ? 'Cancel' : 'Close'}
          </Button>
          {editable && (
            <Button variant="primary" loading={action.isPending} onClick={save} disabled={!rows.length}>
              Save tiers
            </Button>
          )}
        </>
      }
    >
      <div className="adm-stack">
        <div className="muted" style={{ fontSize: 12 }}>
          Positions are margined by the first tier whose max notional covers them. Notional bounds must increase; leverage usually decreases and maintenance
          rates increase with size.
        </div>
        {!editable && <Alert tone="info">Read-only — editing risk tiers requires the risk.write permission.</Alert>}
        <div className="gc-table-wrap" style={{ border: '1px solid var(--c-border)', borderRadius: 8 }}>
          <table className="gc-table adm-tier-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th className="right">Max notional ({market.quote})</th>
                <th className="right">Max leverage</th>
                <th className="right">Maint. margin rate</th>
                <th className="right">Maint. amount</th>
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td className="num">{i + 1}</td>
                  {editable ? (
                    <>
                      <td className="right">
                        <TextInput size="sm" className="adm-inline-input" aria-label={`Tier ${i + 1} max notional`} value={r.maxNotional} error={err(r.key, 'maxNotional')} onChange={(e) => update(r.key, { maxNotional: e.target.value })} />
                      </td>
                      <td className="right">
                        <TextInput size="sm" className="adm-inline-input adm-tier-lev" aria-label={`Tier ${i + 1} max leverage`} value={r.maxLeverage} suffix="x" error={err(r.key, 'maxLeverage')} onChange={(e) => update(r.key, { maxLeverage: e.target.value.replace(/\D/g, '') })} />
                      </td>
                      <td className="right">
                        <TextInput
                          size="sm"
                          className="adm-inline-input"
                          aria-label={`Tier ${i + 1} maintenance margin rate`}
                          value={r.maintenanceMarginRate}
                          error={err(r.key, 'maintenanceMarginRate')}
                          hint={dec(r.maintenanceMarginRate) ? fmtRate(r.maintenanceMarginRate, 3) : undefined}
                          onChange={(e) => update(r.key, { maintenanceMarginRate: e.target.value })}
                        />
                      </td>
                      <td className="right">
                        <TextInput size="sm" className="adm-inline-input" aria-label={`Tier ${i + 1} maintenance amount`} value={r.maintenanceAmount} error={err(r.key, 'maintenanceAmount')} onChange={(e) => update(r.key, { maintenanceAmount: e.target.value })} />
                      </td>
                      <td className="right">
                        <IconButton icon="trash" label={`Remove tier ${i + 1}`} disabled={rows.length <= 1} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="right num">{fmtAmount(r.maxNotional, 2)}</td>
                      <td className="right num">{r.maxLeverage}x</td>
                      <td className="right num">{fmtRate(r.maintenanceMarginRate, 3)}</td>
                      <td className="right num">{fmtAmount(r.maintenanceAmount, 4)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {editable && leverageIncreases && <Alert tone="warn">A higher tier allows more leverage than the tier before it. Double-check the brackets.</Alert>}
        {submitted && general.map((g) => <Alert key={g} tone="error">{g}</Alert>)}
        {action.error ? <Alert tone="error">{errorMessage(action.error)}</Alert> : null}
      </div>
    </AppModal>
  );
}
