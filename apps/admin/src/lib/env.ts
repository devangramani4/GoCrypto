/**
 * Deployment label for the environment badge. The platform runs paper trading with simulated custody
 * (TRADING_MODE=SANDBOX) unless explicitly configured otherwise; override with VITE_ADMIN_ENV_LABEL.
 */
export const ENV_LABEL = (import.meta.env.VITE_ADMIN_ENV_LABEL ?? 'SANDBOX').toUpperCase();

export const IS_LIVE_ENV = ENV_LABEL === 'LIVE' || ENV_LABEL === 'PRODUCTION';
