#!/bin/sh
# One-shot start-up step of the demo container, run by PM2 (see pm2.config.cjs): waits for MariaDB and
# Redis, creates the database and its user, runs the migrations and the seed, then lets the services
# start (after-bootstrap.mjs). If anything fails, the whole container stops so the host reports it.
set -eu

fail() {
  echo "GoCrypto demo bootstrap failed: $1" >&2
  kill -TERM 1
  exit 1
}

i=0
until mariadb-admin --defaults-file="$DEMO_DIR/my.cnf" -u "$(id -un)" ping > /dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -le 240 ] || fail "MariaDB did not start"
  sleep 0.5
done
i=0
until redis-cli -h 127.0.0.1 -p 6379 ping > /dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -le 240 ] || fail "Redis did not start"
  sleep 0.5
done

mariadb --defaults-file="$DEMO_DIR/my.cnf" -u "$(id -un)" <<SQL || fail "could not create the database"
CREATE DATABASE IF NOT EXISTS gocrypto CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'gocrypto'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER 'gocrypto'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON gocrypto.* TO 'gocrypto'@'127.0.0.1';
SQL

cd /app
node database/dist/migrate.js up || fail "database migrations"
node database/dist/seed.js || fail "seed data"
touch "$DEMO_DIR/bootstrapped"

# nginx shows a "starting" page until the API answers.
i=0
until node -e "fetch('http://127.0.0.1:4000/ready').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; do
  i=$((i + 1))
  [ "$i" -le 360 ] || fail "the API did not become ready"
  sleep 0.5
done
touch "$DEMO_DIR/ready"
echo "GoCrypto demo ready: $PUBLIC_URL"
