// Processes of the GoCrypto demo container (see Dockerfile and start.sh). PM2 restarts any that crash.
const DIR = process.env.DEMO_DIR || '/tmp/gocrypto-demo';
const HERE = '/app/infrastructure/demo';

const service = (name, entry) => ({
  name,
  script: `${HERE}/after-bootstrap.mjs`,
  args: [entry],
  cwd: '/app',
  exp_backoff_restart_delay: 500,
  kill_timeout: 15000,
});

module.exports = {
  apps: [
    {
      name: 'mariadb',
      script: 'mariadbd',
      interpreter: 'none',
      args: [`--defaults-file=${DIR}/my.cnf`],
      kill_timeout: 30000,
    },
    { name: 'redis', script: 'redis-server', interpreter: 'none', args: [`${DIR}/redis.conf`] },
    { name: 'bootstrap', script: `${HERE}/bootstrap.sh`, interpreter: 'sh', autorestart: false },
    service('api', 'services/api/dist/main.js'),
    service('websocket', 'services/websocket/dist/main.js'),
    service('matching-engine', 'services/matching-engine/dist/main.js'),
    service('risk-engine', 'services/risk-engine/dist/main.js'),
    service('market-data', 'services/market-data/dist/main.js'),
    service('workers', 'services/workers/dist/main.js'),
    {
      name: 'nginx',
      script: 'nginx',
      interpreter: 'none',
      args: ['-c', `${HERE}/nginx.conf`, '-p', `${DIR}/nginx/`, '-e', 'stderr', '-g', 'daemon off;'],
    },
  ],
};
