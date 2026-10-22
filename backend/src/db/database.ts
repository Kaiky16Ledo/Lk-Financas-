import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync, SQLInputValue } from 'node:sqlite';
import {
  encryptField,
  generateDek,
  generateRecoveryKey,
  hashSecret,
  normalizeRecoveryKey,
  wrapDek,
} from '../crypto/envelope';

/**
 * Camada de persistência — SQLite nativo do Node.js (node:sqlite, Node >= 24) em modo WAL.
 * Não depende de módulos compilados, então funciona igual no Windows, Linux e Docker.
 *
 * Todos os campos terminados em `_enc` guardam payloads AES-256-GCM (enc:v1:iv:tag:hex)
 * cifrados com a DEK do titular. O servidor nunca grava a DEK em texto puro.
 */

export type UserRole = 'TITULAR' | 'SUPORTE';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  password_hash: string;
  pin_hash: string | null;
  wrapped_dek_password: string | null;
  wrapped_dek_pin: string | null;
  wrapped_dek_recovery: string | null;
  recovery_key_hint: string | null;
  font_size_pref: 'NORMAL' | 'LARGE';
  theme_pref: 'LIGHT' | 'DARK';
  failed_login_attempts: number;
  failed_pin_attempts: number;
  reset_authorized_by_support: boolean;
  locked_until: string | null;
  created_at: string;
}

export interface AccountRecord {
  id: string;
  user_id: string;
  name_enc: string;
  institution_enc: string;
  type: 'CHECKING' | 'SAVINGS' | 'CASH';
  balance_enc: string;
  updated_at: string;
}

export interface CreditCardRecord {
  id: string;
  user_id: string;
  account_id: string | null;
  name_enc: string;
  limit_enc: string;
  closing_day: number;
  due_day: number;
  created_at: string;
}

export interface InvestmentRecord {
  id: string;
  user_id: string;
  name_enc: string;
  institution_enc: string;
  category: 'FIXED_INCOME' | 'SAVINGS' | 'PENSION' | 'PATRIMONY';
  principal_amount_enc: string;
  current_value_enc: string;
  monthly_yield_enc: string;
  updated_at: string;
}

export interface CategoryRecord {
  id: string;
  user_id: string;
  name: string;
  type: 'INCOME' | 'EXPENSE';
  color: string;
  icon: string;
}

export interface TransactionRecord {
  id: string;
  user_id: string;
  account_id: string | null;
  credit_card_id: string | null;
  category_id: string | null;
  installment_group_id: string | null;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  description_enc: string;
  amount_enc: string;
  competence_date: string;
  due_date: string;
  status: 'PAID' | 'PENDING';
  is_recurring: boolean;
  installment_number: number;
  total_installments: number;
  created_at: string;
}

export interface AuditLogRecord {
  id: string;
  user_id: string | null;
  actor_role: UserRole | 'ANONYMOUS';
  action: string;
  details: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
}

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '../../data'));
const DB_FILE = path.join(DATA_DIR, 'lk_vault.sqlite');
const FIRST_ACCESS_FILE = path.join(DATA_DIR, 'PRIMEIRO_ACESSO.txt');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('TITULAR', 'SUPORTE')),
  password_hash TEXT NOT NULL,
  pin_hash TEXT,
  wrapped_dek_password TEXT,
  wrapped_dek_pin TEXT,
  wrapped_dek_recovery TEXT,
  recovery_key_hint TEXT,
  font_size_pref TEXT NOT NULL DEFAULT 'LARGE',
  theme_pref TEXT NOT NULL DEFAULT 'LIGHT',
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  failed_pin_attempts INTEGER NOT NULL DEFAULT 0,
  reset_authorized_by_support INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name_enc TEXT NOT NULL,
  institution_enc TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('CHECKING', 'SAVINGS', 'CASH')),
  balance_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  name_enc TEXT NOT NULL,
  limit_enc TEXT NOT NULL,
  closing_day INTEGER NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS investments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name_enc TEXT NOT NULL,
  institution_enc TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('FIXED_INCOME', 'SAVINGS', 'PENSION', 'PATRIMONY')),
  principal_amount_enc TEXT NOT NULL,
  current_value_enc TEXT NOT NULL,
  monthly_yield_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('INCOME', 'EXPENSE')),
  color TEXT NOT NULL,
  icon TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  credit_card_id TEXT REFERENCES credit_cards(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  installment_group_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('INCOME', 'EXPENSE', 'TRANSFER')),
  description_enc TEXT NOT NULL,
  amount_enc TEXT NOT NULL,
  competence_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PAID', 'PENDING')),
  is_recurring INTEGER NOT NULL DEFAULT 0,
  installment_number INTEGER NOT NULL DEFAULT 1,
  total_installments INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_user_due ON transactions(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tx_group ON transactions(installment_group_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`;

let dbInstance: DatabaseSync | null = null;
let inTransaction = false;

export function db(): DatabaseSync {
  if (dbInstance) return dbInstance;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const instance = new DatabaseSync(DB_FILE);
  instance.exec('PRAGMA journal_mode = WAL;');
  instance.exec('PRAGMA foreign_keys = ON;');
  instance.exec(SCHEMA_SQL);
  dbInstance = instance;
  seedIfEmpty();
  return instance;
}

/** Executa várias operações de forma atômica (tudo ou nada). */
export function runInTransaction<T>(fn: () => T): T {
  const instance = dbInstance ?? db();
  if (inTransaction) return fn();
  instance.exec('BEGIN IMMEDIATE');
  inTransaction = true;
  try {
    const result = fn();
    instance.exec('COMMIT');
    return result;
  } catch (err) {
    instance.exec('ROLLBACK');
    throw err;
  } finally {
    inTransaction = false;
  }
}

// ---------------------------------------------------------------------------
// Helpers genéricos
// ---------------------------------------------------------------------------

function insertRow(table: string, row: Record<string, unknown>): void {
  const cols = Object.keys(row);
  const values = cols.map((c) => toSql(row[c]));
  db()
    .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...values);
}

function updateRow(
  table: string,
  allowed: readonly string[],
  where: { id: string; user_id?: string },
  patch: Record<string, unknown>
): void {
  const cols = Object.keys(patch).filter((c) => allowed.includes(c) && patch[c] !== undefined);
  if (cols.length === 0) return;
  const setSql = cols.map((c) => `${c} = ?`).join(', ');
  const params = cols.map((c) => toSql(patch[c]));
  let sql = `UPDATE ${table} SET ${setSql} WHERE id = ?`;
  params.push(where.id);
  if (where.user_id) {
    sql += ' AND user_id = ?';
    params.push(where.user_id);
  }
  db().prepare(sql).run(...params);
}

function toSql(value: unknown): SQLInputValue {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === undefined || value === null) return null;
  return value as SQLInputValue;
}

function mapUser(row: any): UserRecord | undefined {
  if (!row) return undefined;
  return { ...row, reset_authorized_by_support: Boolean(row.reset_authorized_by_support) };
}

function mapTx(row: any): TransactionRecord {
  return { ...row, is_recurring: Boolean(row.is_recurring) };
}

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------

const USER_UPDATABLE = [
  'password_hash',
  'pin_hash',
  'wrapped_dek_password',
  'wrapped_dek_pin',
  'wrapped_dek_recovery',
  'recovery_key_hint',
  'font_size_pref',
  'theme_pref',
  'failed_login_attempts',
  'failed_pin_attempts',
  'reset_authorized_by_support',
  'locked_until',
] as const;

export const users = {
  byEmail(email: string): UserRecord | undefined {
    return mapUser(db().prepare('SELECT * FROM users WHERE email = ?').get(email.trim()));
  },
  byId(id: string): UserRecord | undefined {
    return mapUser(db().prepare('SELECT * FROM users WHERE id = ?').get(id));
  },
  titular(): UserRecord | undefined {
    return mapUser(db().prepare("SELECT * FROM users WHERE role = 'TITULAR' LIMIT 1").get());
  },
  update(id: string, patch: Partial<UserRecord>): void {
    updateRow('users', USER_UPDATABLE, { id }, patch as Record<string, unknown>);
  },
};

// ---------------------------------------------------------------------------
// Contas bancárias
// ---------------------------------------------------------------------------

export const accounts = {
  list(userId: string): AccountRecord[] {
    return db().prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY rowid').all(userId) as unknown as AccountRecord[];
  },
  get(id: string, userId: string): AccountRecord | undefined {
    return db().prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(id, userId) as unknown as
      | AccountRecord
      | undefined;
  },
  insert(row: AccountRecord): void {
    insertRow('accounts', row as unknown as Record<string, unknown>);
  },
  update(id: string, userId: string, patch: Partial<AccountRecord>): void {
    updateRow('accounts', ['name_enc', 'institution_enc', 'balance_enc', 'updated_at'], { id, user_id: userId }, patch as Record<string, unknown>);
  },
  remove(id: string, userId: string): void {
    db().prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(id, userId);
  },
  count(): number {
    return (db().prepare('SELECT COUNT(*) c FROM accounts').get() as { c: number }).c;
  },
};

// ---------------------------------------------------------------------------
// Cartões de crédito
// ---------------------------------------------------------------------------

export const creditCards = {
  list(userId: string): CreditCardRecord[] {
    return db().prepare('SELECT * FROM credit_cards WHERE user_id = ? ORDER BY rowid').all(userId) as unknown as CreditCardRecord[];
  },
  get(id: string, userId: string): CreditCardRecord | undefined {
    return db().prepare('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?').get(id, userId) as unknown as
      | CreditCardRecord
      | undefined;
  },
  insert(row: CreditCardRecord): void {
    insertRow('credit_cards', row as unknown as Record<string, unknown>);
  },
  update(id: string, userId: string, patch: Partial<CreditCardRecord>): void {
    updateRow(
      'credit_cards',
      ['name_enc', 'limit_enc', 'closing_day', 'due_day', 'account_id'],
      { id, user_id: userId },
      patch as Record<string, unknown>
    );
  },
  remove(id: string, userId: string): void {
    db().prepare('DELETE FROM credit_cards WHERE id = ? AND user_id = ?').run(id, userId);
  },
  count(): number {
    return (db().prepare('SELECT COUNT(*) c FROM credit_cards').get() as { c: number }).c;
  },
};

// ---------------------------------------------------------------------------
// Investimentos
// ---------------------------------------------------------------------------

export const investments = {
  list(userId: string): InvestmentRecord[] {
    return db().prepare('SELECT * FROM investments WHERE user_id = ? ORDER BY rowid').all(userId) as unknown as InvestmentRecord[];
  },
  get(id: string, userId: string): InvestmentRecord | undefined {
    return db().prepare('SELECT * FROM investments WHERE id = ? AND user_id = ?').get(id, userId) as unknown as
      | InvestmentRecord
      | undefined;
  },
  insert(row: InvestmentRecord): void {
    insertRow('investments', row as unknown as Record<string, unknown>);
  },
  update(id: string, userId: string, patch: Partial<InvestmentRecord>): void {
    updateRow(
      'investments',
      ['name_enc', 'institution_enc', 'category', 'principal_amount_enc', 'current_value_enc', 'monthly_yield_enc', 'updated_at'],
      { id, user_id: userId },
      patch as Record<string, unknown>
    );
  },
  remove(id: string, userId: string): void {
    db().prepare('DELETE FROM investments WHERE id = ? AND user_id = ?').run(id, userId);
  },
  count(): number {
    return (db().prepare('SELECT COUNT(*) c FROM investments').get() as { c: number }).c;
  },
};

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

export const categories = {
  list(userId: string): CategoryRecord[] {
    return db().prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY rowid').all(userId) as unknown as CategoryRecord[];
  },
  findByName(userId: string, name: string): CategoryRecord | undefined {
    return db()
      .prepare('SELECT * FROM categories WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1')
      .get(userId, name.trim()) as unknown as CategoryRecord | undefined;
  },
  findOrCreate(userId: string, name: string, type: 'INCOME' | 'EXPENSE'): CategoryRecord {
    const clean = name.trim();
    const existing = this.findByName(userId, clean);
    if (existing) return existing;
    const created: CategoryRecord = {
      id: crypto.randomUUID(),
      user_id: userId,
      name: clean,
      type,
      color: type === 'INCOME' ? '#16a34a' : '#0284c7',
      icon: 'Tag',
    };
    this.insert(created);
    return created;
  },
  insert(row: CategoryRecord): void {
    insertRow('categories', row as unknown as Record<string, unknown>);
  },
  remove(id: string, userId: string): void {
    db().prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(id, userId);
  },
};

// ---------------------------------------------------------------------------
// Lançamentos
// ---------------------------------------------------------------------------

export const transactions = {
  list(userId: string): TransactionRecord[] {
    return (db().prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY due_date').all(userId) as any[]).map(mapTx);
  },
  get(id: string, userId: string): TransactionRecord | undefined {
    const row = db().prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(id, userId);
    return row ? mapTx(row) : undefined;
  },
  byGroup(groupId: string, userId: string): TransactionRecord[] {
    return (
      db()
        .prepare('SELECT * FROM transactions WHERE installment_group_id = ? AND user_id = ?')
        .all(groupId, userId) as any[]
    ).map(mapTx);
  },
  insert(row: TransactionRecord): void {
    insertRow('transactions', row as unknown as Record<string, unknown>);
  },
  update(id: string, userId: string, patch: Partial<TransactionRecord>): void {
    updateRow(
      'transactions',
      ['description_enc', 'amount_enc', 'due_date', 'competence_date', 'category_id', 'status', 'type'],
      { id, user_id: userId },
      patch as Record<string, unknown>
    );
  },
  setStatus(id: string, userId: string, status: 'PAID' | 'PENDING'): void {
    updateRow('transactions', ['status'], { id, user_id: userId }, { status });
  },
  remove(id: string, userId: string): void {
    db().prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(id, userId);
  },
  removeByCard(creditCardId: string, userId: string): void {
    db().prepare('DELETE FROM transactions WHERE credit_card_id = ? AND user_id = ?').run(creditCardId, userId);
  },
  sample(limit: number): TransactionRecord[] {
    return (db().prepare('SELECT * FROM transactions ORDER BY rowid LIMIT ?').all(limit) as any[]).map(mapTx);
  },
  count(): number {
    return (db().prepare('SELECT COUNT(*) c FROM transactions').get() as { c: number }).c;
  },
};

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

const AUDIT_RETENTION = 2000;

export function addAuditLog(params: {
  userId: string | null;
  actorRole: UserRole | 'ANONYMOUS';
  action: string;
  details: string;
  ipAddress: string;
  userAgent: string;
}): void {
  insertRow('audit_logs', {
    id: crypto.randomUUID(),
    user_id: params.userId,
    actor_role: params.actorRole,
    action: params.action,
    details: params.details.slice(0, 255),
    ip_address: params.ipAddress.slice(0, 64),
    user_agent: params.userAgent.slice(0, 200),
    created_at: new Date().toISOString(),
  });
  db()
    .prepare(
      `DELETE FROM audit_logs WHERE id NOT IN (SELECT id FROM audit_logs ORDER BY created_at DESC LIMIT ${AUDIT_RETENTION})`
    )
    .run();
}

export const auditLogs = {
  recent(limit: number): AuditLogRecord[] {
    return db().prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?').all(limit) as unknown as AuditLogRecord[];
  },
  count(): number {
    return (db().prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number }).c;
  },
};

/** Gera um snapshot do banco (sem a DEK) para backup. Os campos `_enc` continuam cifrados. */
export function exportSnapshot(): Record<string, unknown[]> {
  const tables = ['users', 'accounts', 'credit_cards', 'investments', 'categories', 'transactions', 'audit_logs'];
  const snapshot: Record<string, unknown[]> = {};
  for (const t of tables) {
    snapshot[t] = db().prepare(`SELECT * FROM ${t}`).all();
  }
  // Hashes de senha/PIN não são necessários num backup de dados.
  snapshot.users = (snapshot.users as any[]).map(({ password_hash, pin_hash, ...rest }) => rest);
  return snapshot;
}

// ---------------------------------------------------------------------------
// Primeira inicialização (seed)
// ---------------------------------------------------------------------------

function randomPassword(): string {
  // 18 caracteres a partir de um alfabeto sem ambiguidades + símbolo e dígito garantidos
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out}#${crypto.randomInt(10)}`;
}

function randomPin(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function seedIfEmpty(): void {
  const instance = dbInstance!;
  const existing = (instance.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
  if (existing > 0) return;

  const isProduction = process.env.NODE_ENV === 'production';
  const now = new Date().toISOString();

  const titularEmail = (process.env.INITIAL_TITULAR_EMAIL || 'pai@financas.familia').toLowerCase();
  const suporteEmail = (process.env.INITIAL_SUPORTE_EMAIL || 'suporte@financas.familia').toLowerCase();
  const titularPassword = process.env.INITIAL_TITULAR_PASSWORD || randomPassword();
  const titularPin = process.env.INITIAL_TITULAR_PIN || randomPin();
  const suportePassword = process.env.INITIAL_SUPORTE_PASSWORD || randomPassword();
  const recoveryKey = generateRecoveryKey();

  if (titularPassword.length < 10 || suportePassword.length < 10) {
    throw new Error('As senhas iniciais (INITIAL_*_PASSWORD) devem ter pelo menos 10 caracteres.');
  }
  if (!/^\d{4,6}$/.test(titularPin)) {
    throw new Error('INITIAL_TITULAR_PIN deve conter de 4 a 6 números.');
  }

  const titularId = crypto.randomUUID();
  const suporteId = crypto.randomUUID();
  const dek = generateDek();

  runInTransaction(() => {
    insertRow('users', {
      id: titularId,
      name: process.env.INITIAL_TITULAR_NAME || 'Titular',
      email: titularEmail,
      role: 'TITULAR',
      password_hash: hashSecret(titularPassword),
      pin_hash: hashSecret(titularPin),
      wrapped_dek_password: wrapDek(dek, titularPassword),
      wrapped_dek_pin: wrapDek(dek, titularPin),
      wrapped_dek_recovery: wrapDek(dek, normalizeRecoveryKey(recoveryKey)),
      recovery_key_hint: `${recoveryKey.slice(0, 4)}-****-****-****-****-${recoveryKey.slice(-4)}`,
      font_size_pref: 'LARGE',
      theme_pref: 'LIGHT',
      failed_login_attempts: 0,
      failed_pin_attempts: 0,
      reset_authorized_by_support: 0,
      locked_until: null,
      created_at: now,
    });

    insertRow('users', {
      id: suporteId,
      name: 'Suporte Técnico',
      email: suporteEmail,
      role: 'SUPORTE',
      password_hash: hashSecret(suportePassword),
      pin_hash: null,
      wrapped_dek_password: null,
      wrapped_dek_pin: null,
      wrapped_dek_recovery: null,
      recovery_key_hint: null,
      font_size_pref: 'NORMAL',
      theme_pref: 'DARK',
      failed_login_attempts: 0,
      failed_pin_attempts: 0,
      reset_authorized_by_support: 0,
      locked_until: null,
      created_at: now,
    });

    const seedDemo = process.env.SEED_DEMO_DATA === 'true';
    if (seedDemo) seedDemoData(titularId, dek, now);

    insertRow('audit_logs', {
      id: crypto.randomUUID(),
      user_id: titularId,
      actor_role: 'TITULAR',
      action: 'SYSTEM_INITIALIZED',
      details: `Cofre inicializado (AES-256-GCM, envelope encryption). Dados de exemplo: ${seedDemo ? 'sim' : 'não'}.`,
      ip_address: '127.0.0.1',
      user_agent: 'System/Bootstrap',
      created_at: now,
    });
  });

  // As credenciais iniciais NUNCA vão para o terminal nem para a tela de login.
  // Ficam num arquivo único, legível só pelo dono, que deve ser apagado após o primeiro acesso.
  const content = [
    'LK FINANÇAS — CREDENCIAIS DE PRIMEIRO ACESSO',
    '============================================',
    'Anote em local seguro e APAGUE ESTE ARQUIVO depois do primeiro login.',
    'Recomenda-se trocar a senha e o PIN em "Relatórios & Segurança" logo no primeiro acesso.',
    '',
    '[TITULAR]',
    `E-mail: ${titularEmail}`,
    `Senha:  ${process.env.INITIAL_TITULAR_PASSWORD ? '(definida em INITIAL_TITULAR_PASSWORD)' : titularPassword}`,
    `PIN:    ${process.env.INITIAL_TITULAR_PIN ? '(definido em INITIAL_TITULAR_PIN)' : titularPin}`,
    `Chave de Recuperação de Emergência: ${recoveryKey}`,
    '  -> Imprima/anote e guarde fisicamente. Sem ela, uma senha esquecida não pode ser recuperada.',
    '',
    '[SUPORTE]',
    `E-mail: ${suporteEmail}`,
    `Senha:  ${process.env.INITIAL_SUPORTE_PASSWORD ? '(definida em INITIAL_SUPORTE_PASSWORD)' : suportePassword}`,
    '',
  ].join('\n');
  fs.writeFileSync(FIRST_ACCESS_FILE, content, { encoding: 'utf8', mode: 0o600 });
}

function seedDemoData(userId: string, dek: string, now: string): void {
  const acc1 = crypto.randomUUID();
  const acc2 = crypto.randomUUID();
  const acc3 = crypto.randomUUID();
  const accRows: Array<[string, string, string, 'CHECKING' | 'SAVINGS' | 'CASH', number]> = [
    [acc1, 'Conta Corrente Principal', 'Banco do Brasil', 'CHECKING', 6450],
    [acc2, 'Poupança de Reserva', 'Caixa Econômica', 'SAVINGS', 18200],
    [acc3, 'Dinheiro em Espécie (Casa)', 'Carteira', 'CASH', 450],
  ];
  for (const [id, name, inst, type, bal] of accRows) {
    insertRow('accounts', {
      id,
      user_id: userId,
      name_enc: encryptField(name, dek),
      institution_enc: encryptField(inst, dek),
      type,
      balance_enc: encryptField(bal, dek),
      updated_at: now,
    });
  }

  const cardId = crypto.randomUUID();
  insertRow('credit_cards', {
    id: cardId,
    user_id: userId,
    account_id: acc1,
    name_enc: encryptField('Cartão Visa', dek),
    limit_enc: encryptField(8000, dek),
    closing_day: 5,
    due_day: 12,
    created_at: now,
  });

  const invRows: Array<[string, string, InvestmentRecord['category'], number, number, number]> = [
    ['Tesouro Selic / Reserva', 'Banco do Brasil', 'FIXED_INCOME', 45000, 49850, 0.95],
    ['CDB Pós-Fixado 105% CDI', 'Banco Itaú', 'FIXED_INCOME', 30000, 33120, 1.02],
    ['Previdência Complementar', 'Brasilprev', 'PENSION', 60000, 68400, 0.85],
  ];
  for (const [name, inst, category, principal, current, yieldM] of invRows) {
    insertRow('investments', {
      id: crypto.randomUUID(),
      user_id: userId,
      name_enc: encryptField(name, dek),
      institution_enc: encryptField(inst, dek),
      category,
      principal_amount_enc: encryptField(principal, dek),
      current_value_enc: encryptField(current, dek),
      monthly_yield_enc: encryptField(yieldM, dek),
      updated_at: now,
    });
  }

  const today = new Date();
  const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const daySoon = String(Math.min(28, today.getDate() + 2)).padStart(2, '0');
  const dayNext = String(Math.min(28, today.getDate() + 5)).padStart(2, '0');

  const txRows: Array<{
    acc: string | null; card: string | null; type: 'INCOME' | 'EXPENSE';
    desc: string; amount: number; due: string; status: 'PAID' | 'PENDING'; rec: boolean;
    n?: number; total?: number; group?: string;
  }> = [
    { acc: acc1, card: null, type: 'INCOME', desc: 'Depósito Mensal Aposentadoria', amount: 5800, due: `${ym}-05`, status: 'PAID', rec: true },
    { acc: acc1, card: null, type: 'EXPENSE', desc: 'Conta de Energia Elétrica', amount: 285.4, due: `${ym}-${daySoon}`, status: 'PENDING', rec: true },
    { acc: acc1, card: null, type: 'EXPENSE', desc: 'Plano de Saúde + Farmácia', amount: 890, due: `${ym}-${dayNext}`, status: 'PENDING', rec: true },
    { acc: acc1, card: null, type: 'EXPENSE', desc: 'Compra do Mês no Supermercado', amount: 740, due: `${ym}-06`, status: 'PAID', rec: false },
    { acc: null, card: cardId, type: 'EXPENSE', desc: 'Revisão do Carro (Parcela 1/4)', amount: 350, due: `${ym}-12`, status: 'PENDING', rec: false, n: 1, total: 4, group: crypto.randomUUID() },
  ];
  for (const t of txRows) {
    insertRow('transactions', {
      id: crypto.randomUUID(),
      user_id: userId,
      account_id: t.acc,
      credit_card_id: t.card,
      category_id: null,
      installment_group_id: t.group ?? null,
      type: t.type,
      description_enc: encryptField(t.desc, dek),
      amount_enc: encryptField(t.amount, dek),
      competence_date: t.due,
      due_date: t.due,
      status: t.status,
      is_recurring: t.rec ? 1 : 0,
      installment_number: t.n ?? 1,
      total_installments: t.total ?? 1,
      created_at: now,
    });
  }
}
