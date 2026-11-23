#!/bin/sh
# Entrypoint of the GoCrypto demo container (see Dockerfile). Runs as the unprivileged container user:
# prepares MariaDB, Redis and nginx under /tmp, sets the environment, then hands over to PM2, which
# runs the database, the cache, the one-shot bootstrap (migrations + seed), every service and nginx.
set -eu

DEMO_DIR=/tmp/gocrypto-demo
export DEMO_DIR
mkdir -p "$DEMO_DIR/mysql" "$DEMO_DIR/redis" "$DEMO_DIR/nginx" "$DEMO_DIR/run"
rm -f "$DEMO_DIR/bootstrapped" "$DEMO_DIR/ready"

# The address people open. Hugging Face sets SPACE_HOST; anywhere else, pass PUBLIC_URL.
if [ -n "${SPACE_HOST:-}" ]; then PUBLIC_URL="https://${SPACE_HOST}"; fi
PUBLIC_URL="${PUBLIC_URL:-http://localhost:7860}"
export PUBLIC_URL

# Secrets are generated once per data directory and never leave the container.
if [ ! -f "$DEMO_DIR/secrets.env" ]; then
  umask 077
  node -e '
    const r = (n, enc = "base64url") => require("crypto").randomBytes(n).toString(enc);
    process.stdout.write([
      `DB_PASSWORD=${r(24)}`,
      `JWT_SECRET=${r(48)}`,
      `JWT_REFRESH_SECRET=${r(48)}`,
      `ENCRYPTION_KEY=${r(32, "base64")}`,
      `METRICS_TOKEN=${r(24)}`,
    ].join("\n") + "\n");
  ' > "$DEMO_DIR/secrets.env"
  umask 022
fi
set -a
. "$DEMO_DIR/secrets.env"
set +a

export NODE_ENV=production APP_ENV=staging TRADING_MODE=SANDBOX MARKET_DATA_MODE=SIMULATED ENGINE_MODE=redis
export DATABASE_URL="mysql://gocrypto:${DB_PASSWORD}@127.0.0.1:3306/gocrypto" DATABASE_POOL_SIZE=8
export REDIS_URL=redis://127.0.0.1:6379/0
export API_HOST=127.0.0.1 API_PORT=4000 WS_PORT=4001 TRUST_PROXY=true LOG_PRETTY=false
export LOG_LEVEL="${LOG_LEVEL:-info}"
export WEB_APP_URL="$PUBLIC_URL" ADMIN_APP_URL="$PUBLIC_URL" API_PUBLIC_URL="$PUBLIC_URL" CORS_ORIGINS="$PUBLIC_URL"
export PM2_HOME="$DEMO_DIR/pm2"

cat > "$DEMO_DIR/my.cnf" <<EOF
[mariadbd]
datadir=$DEMO_DIR/mysql
socket=$DEMO_DIR/run/mysqld.sock
pid-file=$DEMO_DIR/run/mysqld.pid
tmpdir=$DEMO_DIR/run
bind-address=127.0.0.1
port=3306
skip-name-resolve
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
transaction-isolation=READ-COMMITTED
default-time-zone=+00:00
innodb-buffer-pool-size=256M
# The demo database is thrown away on restart, so trade durability for speed.
innodb-flush-log-at-trx-commit=2
max-connections=300

[client]
socket=$DEMO_DIR/run/mysqld.sock
EOF

cat > "$DEMO_DIR/redis.conf" <<EOF
bind 127.0.0.1
port 6379
protected-mode yes
dir $DEMO_DIR/redis
save ""
appendonly no
# BullMQ queues and engine streams must never be evicted.
maxmemory-policy noeviction
EOF

if [ ! -d "$DEMO_DIR/mysql/mysql" ]; then
  # The container user gets a socket-authenticated admin account (it cannot use root's, and --user
  # would need root to change file owners).
  if ! mariadb-install-db --defaults-file="$DEMO_DIR/my.cnf" --auth-root-authentication-method=socket \
    --auth-root-socket-user="$(id -un)" --skip-test-db > "$DEMO_DIR/mariadb-install.log" 2>&1; then
    cat "$DEMO_DIR/mariadb-install.log" >&2
    exit 1
  fi
fi

echo "GoCrypto demo starting on $PUBLIC_URL (sandbox: simulated prices and funds)"
exec pm2-runtime /app/infrastructure/demo/pm2.config.cjs
