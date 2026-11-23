// Integration tests run against a dedicated database, Redis DB and key prefix.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'mysql://gocrypto:gocrypto_dev_pw@127.0.0.1:3306/gocrypto_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/1';
process.env.REDIS_KEY_PREFIX = 'gctest:';
process.env.EMAIL_CONFIG = 'log';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
process.env.ENGINE_MODE = 'inprocess';
process.env.SEED_ADMIN_PASSWORD = 'AdminPassw0rd!2026';
process.env.SEED_DEMO_USER = 'false';
process.env.RATE_LIMIT_MAX = '100000';
process.env.ORDER_RATE_LIMIT_PER_SEC = '1000';
process.env.GOCRYPTO_SKIP_DOTENV = '1';
