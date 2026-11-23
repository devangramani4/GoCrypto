import { D } from '@gocrypto/trading-utils';
import { Icon, useToast } from '@gocrypto/ui';
import { QRCodeSVG } from 'qrcode.react';
import type { ReactNode } from 'react';
import { coinColor, formatPercent, signClass } from '../../lib/format';
import { useDirection } from '../../lib/hooks';

export function AssetIcon({ asset, size = 22 }: { asset: string; size?: number }) {
  return (
    <span
      className="asset-icon"
      style={{ width: size, height: size, background: coinColor(asset), fontSize: Math.max(8, size * 0.38) }}
      aria-hidden="true"
    >
      {asset.slice(0, asset.length > 4 ? 3 : 4).slice(0, 3)}
    </span>
  );
}

export function AssetLabel({ asset, sub }: { asset: string; sub?: ReactNode }) {
  return (
    <span className="row" style={{ gap: 10 }}>
      <AssetIcon asset={asset} />
      <span className="col" style={{ gap: 0 }}>
        <strong style={{ fontWeight: 600 }}>{asset}</strong>
        {sub && <span className="faint" style={{ fontSize: 11 }}>{sub}</span>}
      </span>
    </span>
  );
}

export function ChangePct({ value, className }: { value: string | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className="faint">—</span>;
  return <span className={`num ${signClass(value)} ${className ?? ''}`}>{formatPercent(value)}</span>;
}

export function PnL({ value, suffix, className }: { value: string | null | undefined; suffix?: string; className?: string }) {
  if (value === null || value === undefined) return <span className="faint">—</span>;
  const d = D(value);
  const text = `${d.gt(0) ? '+' : ''}${d.toDecimalPlaces(2).toFixed(2)}${suffix ? ` ${suffix}` : ''}`;
  return <span className={`num ${signClass(value)} ${className ?? ''}`}>{text}</span>;
}

/** Price that briefly flashes green/red when it ticks. */
export function LivePrice({ value, text, className }: { value: string | null | undefined; text: string; className?: string }) {
  const dir = useDirection(value);
  return (
    <span key={value ?? ''} className={`num ${dir ? `flash-${dir}` : ''} ${dir ? dir : ''} ${className ?? ''}`}>
      {text}
    </span>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="gc-icon-btn"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => toast.success('Copied to clipboard'));
      }}
    >
      <Icon name="copy" size={15} />
    </button>
  );
}

export function QrCode({ value, size = 148 }: { value: string; size?: number }) {
  return (
    <div className="qr">
      <QRCodeSVG value={value} size={size} bgColor="#ffffff" fgColor="#0a0d12" level="M" />
    </div>
  );
}

export function SandboxBanner() {
  return (
    <div className="sandbox-banner">
      <Icon name="info" size={13} /> Sandbox environment — paper trading with simulated funds. No real assets are moved.
    </div>
  );
}
