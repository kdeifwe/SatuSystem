import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_ENV = 'GOOGLE_TOKEN_ENCRYPTION_KEY';

function getEncryptionKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(`Переменная ${KEY_ENV} не задана. Генерируйте: openssl rand -base64 32`);
  }

  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32) {
    throw new Error(`${KEY_ENV} должна содержать 32 байта после base64 декодирования.`);
  }

  return decoded;
}

export function encryptSecret(secret: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  if (!payload || !payload.startsWith('v1:')) {
    throw new Error('Неверный формат зашифрованного токена.');
  }

  const [version, ivHex, tagHex, ciphertextHex] = payload.split(':');
  if (version !== 'v1' || !ivHex || !tagHex || !ciphertextHex) {
    throw new Error('Неверный формат зашифрованного токена.');
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (error) {
    throw new Error(`Не удалось расшифровать токен: key mismatch or decrypt failed (${error instanceof Error ? error.message : 'decrypt failed'})`);
  }
}
