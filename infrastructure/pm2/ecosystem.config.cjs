/**
 * PM2 process file for VM / bare-metal deployments (no containers).
 *
 *   pnpm install --frozen-lockfile && pnpm build:backend
 *   node database/dist/migrate.js up && node database/dist/seed.js
 *   pm2 start infrastructure/pm2/ecosystem.config.cjs --env production
 *   pm2 save && pm2 startup
 *
 * Secrets come from the environment (systemd EnvironmentFile, Vault agent, …) — never from this file.
 * Scaling notes: api/websocket/workers are stateless and may run several instances (Socket.IO uses the
 * websocket transport only, fan-out goes through Redis). matching-engine, risk-engine and market-data
 * use Redis leader election: extra instances are hot standbys.
 */
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const common = {
  cwd: root,
  exec_mode: 'fork',
  autorestart: true,
  max_restarts: 50,
  min_uptime: '10s',
  exp_backoff_restart_delay: 200,
  kill_timeout: 30000,
  max_memory_restart: '1G',
  time: true,
  merge_logs: true,
  node_args: ['--enable-source-maps'],
  env: { NODE_ENV: 'development' },
  env_production: { NODE_ENV: 'production', LOG_PRETTY: 'false', TRUST_PROXY: 'true' },
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'gc-api',
      script: 'services/api/dist/main.js',
      instances: Number(process.env.API_INSTANCES || 2),
      exec_mode: 'cluster',
    },
    {
      ...common,
      name: 'gc-websocket',
      script: 'services/websocket/dist/main.js',
      instances: Number(process.env.WS_INSTANCES || 1),
    },
    {
      ...common,
      name: 'gc-matching-engine',
      script: 'services/matching-engine/dist/main.js',
      instances: 1,
      max_memory_restart: '2G',
      env: { ...common.env, METRICS_PORT: '9101' },
      env_production: { ...common.env_production, METRICS_PORT: '9101' },
    },
    {
      ...common,
      name: 'gc-risk-engine',
      script: 'services/risk-engine/dist/main.js',
      instances: 1,
      env: { ...common.env, METRICS_PORT: '9102' },
      env_production: { ...common.env_production, METRICS_PORT: '9102' },
    },
    {
      ...common,
      name: 'gc-market-data',
      script: 'services/market-data/dist/main.js',
      instances: 1,
      env: { ...common.env, METRICS_PORT: '9103' },
      env_production: { ...common.env_production, METRICS_PORT: '9103' },
    },
    {
      ...common,
      name: 'gc-workers',
      script: 'services/workers/dist/main.js',
      instances: 1,
      env: { ...common.env, METRICS_PORT: '9104' },
      env_production: { ...common.env_production, METRICS_PORT: '9104' },
    },
  ],
};
