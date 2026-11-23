-- +migrate Up
-- Users, authentication, RBAC, sessions, devices, notifications and audit trail.

CREATE TABLE roles (
  code         VARCHAR(32)  NOT NULL,
  name         VARCHAR(64)  NOT NULL,
  description  VARCHAR(255) NULL,
  is_system    TINYINT(1)   NOT NULL DEFAULT 1,
  is_admin     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE permissions (
  code         VARCHAR(64)  NOT NULL,
  description  VARCHAR(255) NOT NULL,
  category     VARCHAR(32)  NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE role_permissions (
  role_code        VARCHAR(32) NOT NULL,
  permission_code  VARCHAR(64) NOT NULL,
  PRIMARY KEY (role_code, permission_code),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_code) REFERENCES roles (code) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_perm FOREIGN KEY (permission_code) REFERENCES permissions (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uid                  VARCHAR(12)  NOT NULL,
  email                VARCHAR(254) NOT NULL,
  email_verified_at    DATETIME(3)  NULL,
  phone                VARCHAR(20)  NULL,
  phone_verified_at    DATETIME(3)  NULL,
  password_hash        VARCHAR(255) NULL,
  display_name         VARCHAR(50)  NULL,
  role                 VARCHAR(32)  NOT NULL DEFAULT 'USER',
  status               ENUM('ACTIVE','FROZEN','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  status_reason        VARCHAR(500) NULL,
  trading_enabled      TINYINT(1)   NOT NULL DEFAULT 1,
  withdrawals_enabled  TINYINT(1)   NOT NULL DEFAULT 1,
  kyc_level            TINYINT UNSIGNED NOT NULL DEFAULT 0,
  vip_tier             TINYINT UNSIGNED NOT NULL DEFAULT 0,
  is_system            TINYINT(1)   NOT NULL DEFAULT 0,
  locale               VARCHAR(10)  NOT NULL DEFAULT 'en',
  referral_code        VARCHAR(16)  NULL,
  referred_by          BIGINT UNSIGNED NULL,
  last_login_at        DATETIME(3)  NULL,
  created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at           DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_uid (uid),
  UNIQUE KEY uq_users_phone (phone),
  UNIQUE KEY uq_users_referral (referral_code),
  KEY idx_users_status (status),
  KEY idx_users_role (role),
  KEY idx_users_created (created_at),
  CONSTRAINT fk_users_role FOREIGN KEY (role) REFERENCES roles (code),
  CONSTRAINT fk_users_referred_by FOREIGN KEY (referred_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_security (
  user_id                BIGINT UNSIGNED NOT NULL,
  totp_secret_enc        VARCHAR(512) NULL,
  totp_pending_secret_enc VARCHAR(512) NULL,
  totp_enabled           TINYINT(1)   NOT NULL DEFAULT 0,
  totp_enabled_at        DATETIME(3)  NULL,
  totp_last_used_step    BIGINT       NULL,
  backup_codes           JSON         NULL,
  trading_pin_hash       VARCHAR(255) NULL,
  pin_failed_attempts    INT          NOT NULL DEFAULT 0,
  pin_locked_until       DATETIME(3)  NULL,
  failed_login_attempts  INT          NOT NULL DEFAULT 0,
  login_locked_until     DATETIME(3)  NULL,
  password_changed_at    DATETIME(3)  NULL,
  withdrawal_lock_until  DATETIME(3)  NULL,
  anti_phishing_code     VARCHAR(20)  NULL,
  updated_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_security_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_settings (
  user_id             BIGINT UNSIGNED NOT NULL,
  notification_prefs  JSON        NOT NULL,
  theme               VARCHAR(10) NOT NULL DEFAULT 'dark',
  confirm_orders      TINYINT(1)  NOT NULL DEFAULT 1,
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_identities (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  provider          ENUM('GOOGLE','APPLE') NOT NULL,
  provider_user_id  VARCHAR(255) NOT NULL,
  email             VARCHAR(254) NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_identity_provider (provider, provider_user_id),
  KEY idx_identity_user (user_id),
  CONSTRAINT fk_identity_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_devices (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NOT NULL,
  device_id      VARCHAR(128) NOT NULL,
  name           VARCHAR(100) NULL,
  platform       ENUM('WEB','IOS','ANDROID','DESKTOP','API') NOT NULL DEFAULT 'WEB',
  user_agent     VARCHAR(512) NULL,
  last_ip        VARCHAR(45)  NULL,
  last_seen_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  trusted        TINYINT(1)   NOT NULL DEFAULT 0,
  push_token     VARCHAR(512) NULL,
  push_provider  VARCHAR(10)  NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at     DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_user (user_id, device_id),
  KEY idx_device_last_seen (last_seen_at),
  CONSTRAINT fk_device_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_sessions (
  id                CHAR(36)     NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  device_row_id     BIGINT UNSIGNED NULL,
  refresh_jti_hash  CHAR(64)     NOT NULL,
  previous_jti_hash CHAR(64)     NULL,
  rotated_at        DATETIME(3)  NULL,
  rotation_counter  INT          NOT NULL DEFAULT 0,
  platform          ENUM('WEB','IOS','ANDROID','DESKTOP','API') NOT NULL DEFAULT 'WEB',
  ip                VARCHAR(45)  NULL,
  user_agent        VARCHAR(512) NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at        DATETIME(3)  NOT NULL,
  revoked_at        DATETIME(3)  NULL,
  revoke_reason     VARCHAR(64)  NULL,
  PRIMARY KEY (id),
  KEY idx_sessions_user (user_id, revoked_at),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_sessions_device FOREIGN KEY (device_row_id) REFERENCES user_devices (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE login_history (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NULL,
  email           VARCHAR(254) NULL,
  method          VARCHAR(16)  NOT NULL DEFAULT 'PASSWORD',
  success         TINYINT(1)   NOT NULL,
  failure_reason  VARCHAR(64)  NULL,
  ip              VARCHAR(45)  NULL,
  user_agent      VARCHAR(512) NULL,
  platform        ENUM('WEB','IOS','ANDROID','DESKTOP','API') NULL,
  device_id       VARCHAR(128) NULL,
  device_name     VARCHAR(100) NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_login_user (user_id, id),
  KEY idx_login_ip (ip, created_at),
  KEY idx_login_created (created_at),
  CONSTRAINT fk_login_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE api_keys (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  key_id        CHAR(32)     NOT NULL,
  secret_enc    VARCHAR(512) NOT NULL,
  label         VARCHAR(50)  NOT NULL,
  permissions   JSON         NOT NULL,
  ip_whitelist  JSON         NOT NULL,
  last_used_at  DATETIME(3)  NULL,
  last_used_ip  VARCHAR(45)  NULL,
  expires_at    DATETIME(3)  NULL,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at    DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_keys_key (key_id),
  KEY idx_api_keys_user (user_id, revoked_at),
  CONSTRAINT fk_api_keys_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  type        VARCHAR(40)   NOT NULL,
  category    VARCHAR(16)   NOT NULL,
  title       VARCHAR(200)  NOT NULL,
  body        VARCHAR(1000) NOT NULL,
  data        JSON          NULL,
  read_at     DATETIME(3)   NULL,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_notifications_user (user_id, id),
  KEY idx_notifications_unread (user_id, read_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id  BIGINT UNSIGNED NULL,
  actor_type     ENUM('USER','ADMIN','SYSTEM') NOT NULL,
  action         VARCHAR(64)  NOT NULL,
  target_type    VARCHAR(32)  NULL,
  target_id      VARCHAR(64)  NULL,
  ip             VARCHAR(45)  NULL,
  user_agent     VARCHAR(512) NULL,
  metadata       JSON         NULL,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_actor (actor_user_id, id),
  KEY idx_audit_target (target_type, target_id),
  KEY idx_audit_action (action, created_at),
  KEY idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE security_alerts (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NULL,
  type         VARCHAR(32) NOT NULL,
  severity     ENUM('LOW','MEDIUM','HIGH') NOT NULL DEFAULT 'LOW',
  ip           VARCHAR(45) NULL,
  details      JSON        NULL,
  resolved_at  DATETIME(3) NULL,
  resolved_by  BIGINT UNSIGNED NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_alerts_open (resolved_at, id),
  KEY idx_alerts_user (user_id, id),
  CONSTRAINT fk_alerts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE system_settings (
  setting_key  VARCHAR(64) NOT NULL,
  value        JSON        NOT NULL,
  updated_by   BIGINT UNSIGNED NULL,
  updated_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +migrate Down
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS security_alerts;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS login_history;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS user_devices;
DROP TABLE IF EXISTS user_identities;
DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS user_security;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
