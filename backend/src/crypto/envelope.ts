import crypto from 'node:crypto';

/**
 * Motor Criptográfico Zero-Knowledge (Envelope Encryption)
 *
 * Arquitetura de Segurança:
 * 1. Cada titular possui uma Data Encryption Key (DEK) aleatória de 256 bits (32 bytes).
 * 2. A DEK NUNCA é armazenada em texto puro no banco de dados.
 * 3. A DEK é encapsulada (wrapped) com AES-256-GCM em 3 cápsulas independentes:
 *    - Cápsula Senha: Chave derivada (KEK) da Senha Forte do Pai via scrypt (N=16384, r=8, p=1)
 *    - Cápsula PIN: Chave derivada (KEK) do PIN de 4-6 dígitos (invalidada após 3 erros)
 *    - Cápsula Recuperação: Chave derivada (KEK) do Código de Emergência de 24 caracteres
 * 4. Todos os saldos, valores, descrições, limites e patrimônios são cifrados com AES-256-GCM
 *    usando a DEK (autenticados com IV único de 96 bits + AuthTag de 128 bits).
 */

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const KEY_LEN = 32; // 256 bits

/**
 * Gera um hash seguro para autenticação de Senha ou PIN usando scrypt + salt aleatório de 16 bytes.
 */
export function hashSecret(secret: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(secret.normalize('NFKC'), salt, 64, SCRYPT_PARAMS);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Verifica um segredo (Senha ou PIN) em tempo constante (timing-safe) contra o hash armazenado.
 */
export function verifySecret(secret: string, storedHash: string): boolean {
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const derived = crypto.scryptSync(secret.normalize('NFKC'), salt, expected.length, SCRYPT_PARAMS);
    return crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

/**
 * Gera uma Data Encryption Key (DEK) aleatória de 256 bits (retornada em hex de 64 caracteres).
 */
export function generateDek(): string {
  return crypto.randomBytes(KEY_LEN).toString('hex');
}

/**
 * Gera uma Chave de Recuperação de Emergência legível no formato XXXX-XXXX-XXXX-XXXX-XXXX-XXXX.
 */
export function generateRecoveryKey(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Sem caracteres ambíguos (0, O, 1, I)
  const groups: string[] = [];
  for (let g = 0; g < 6; g++) {
    let part = '';
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i++) {
      part += alphabet[bytes[i] % alphabet.length];
    }
    groups.push(part);
  }
  return groups.join('-');
}

/**
 * Normaliza a Chave de Recuperação (remove espaços e hífens e converte para maiúsculas).
 */
export function normalizeRecoveryKey(key: string): string {
  return key.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Encapsula (Wrap) a DEK usando um segredo do usuário (Senha, PIN ou Chave de Recuperação).
 * Formato de saída: saltHex:ivHex:authTagHex:encryptedDekHex
 */
export function wrapDek(dekHex: string, userSecret: string): string {
  const salt = crypto.randomBytes(16);
  const kek = crypto.scryptSync(userSecret.normalize('NFKC'), salt, KEY_LEN, SCRYPT_PARAMS);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);

  const dekBuffer = Buffer.from(dekHex, 'hex');
  const encrypted = Buffer.concat([cipher.update(dekBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

/**
 * Desencapsula (Unwrap) a DEK usando o segredo fornecido pelo usuário.
 * Lança erro caso o segredo esteja incorreto ou a cápsula tenha sido adulterada.
 */
export function unwrapDek(wrappedDek: string, userSecret: string): string {
  const parts = wrappedDek.split(':');
  if (parts.length !== 4) {
    throw new Error('Formato de cápsula criptográfica inválido.');
  }
  const [saltHex, ivHex, authTagHex, ciphertextHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const kek = crypto.scryptSync(userSecret.normalize('NFKC'), salt, KEY_LEN, SCRYPT_PARAMS);
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('hex');
}

/**
 * Criptografa um campo sensível (saldo, valor, descrição, limite, patrimônio) com AES-256-GCM usando a DEK.
 * Formato: enc:v1:ivHex:authTagHex:ciphertextHex
 */
export function encryptField(plaintext: string | number, dekHex: string): string {
  const text = String(plaintext);
  const key = Buffer.from(dekHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `enc:v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Descriptografa um campo sensível autenticado com AES-256-GCM usando a DEK.
 */
export function decryptField(ciphertextPayload: string, dekHex: string): string {
  if (!ciphertextPayload || !ciphertextPayload.startsWith('enc:v1:')) {
    throw new Error('Dado não está em formato criptografado válido.');
  }
  const parts = ciphertextPayload.split(':');
  if (parts.length !== 5) {
    throw new Error('Payload criptografado corrompido.');
  }
  const [, , ivHex, authTagHex, dataHex] = parts;
  const key = Buffer.from(dekHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(dataHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Descriptografa um valor numérico financeiro com precisão de centavos.
 */
export function decryptNumber(ciphertextPayload: string, dekHex: string): number {
  const raw = decryptField(ciphertextPayload, dekHex);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
