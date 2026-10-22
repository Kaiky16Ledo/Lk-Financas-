-- ============================================================================
-- SCHEMA SQL — SISTEMA DE FINANÇAS PESSOAIS ZERO-KNOWLEDGE (PostgreSQL / SQLite)
-- Todos os campos terminados em _enc armazenam payloads AES-256-GCM (enc:v1:iv:tag:hex)
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(160) UNIQUE NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('TITULAR', 'SUPORTE')),
    password_hash TEXT NOT NULL,
    pin_hash TEXT,
    wrapped_dek_password TEXT,
    wrapped_dek_pin TEXT,
    wrapped_dek_recovery TEXT,
    recovery_key_hint VARCHAR(32),
    font_size_pref VARCHAR(10) NOT NULL DEFAULT 'LARGE',
    theme_pref VARCHAR(10) NOT NULL DEFAULT 'LIGHT',
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    failed_pin_attempts INTEGER NOT NULL DEFAULT 0,
    reset_authorized_by_support BOOLEAN NOT NULL DEFAULT FALSE,
    locked_until TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name_enc TEXT NOT NULL,
    institution_enc TEXT NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('CHECKING', 'SAVINGS', 'CASH')),
    balance_enc TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credit_cards (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id VARCHAR(36) REFERENCES accounts(id) ON DELETE SET NULL,
    name_enc TEXT NOT NULL,
    limit_enc TEXT NOT NULL,
    closing_day INTEGER NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
    due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS investments (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name_enc TEXT NOT NULL,
    institution_enc TEXT NOT NULL,
    category VARCHAR(30) NOT NULL CHECK (category IN ('FIXED_INCOME', 'SAVINGS', 'PENSION', 'PATRIMONY')),
    principal_amount_enc TEXT NOT NULL,
    current_value_enc TEXT NOT NULL,
    monthly_yield_enc TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('INCOME', 'EXPENSE')),
    color VARCHAR(20) NOT NULL,
    icon VARCHAR(40) NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id VARCHAR(36) REFERENCES accounts(id) ON DELETE SET NULL,
    credit_card_id VARCHAR(36) REFERENCES credit_cards(id) ON DELETE SET NULL,
    category_id VARCHAR(36) REFERENCES categories(id) ON DELETE SET NULL,
    installment_group_id VARCHAR(36),
    type VARCHAR(20) NOT NULL CHECK (type IN ('INCOME', 'EXPENSE', 'TRANSFER')),
    description_enc TEXT NOT NULL,
    amount_enc TEXT NOT NULL,
    competence_date DATE NOT NULL,
    due_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('PAID', 'PENDING')),
    is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
    installment_number INTEGER NOT NULL DEFAULT 1,
    total_installments INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36),
    actor_role VARCHAR(20) NOT NULL,
    action VARCHAR(80) NOT NULL,
    details VARCHAR(255) NOT NULL,
    ip_address VARCHAR(64) NOT NULL,
    user_agent VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
