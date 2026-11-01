import { app, safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const keyPath = () => join(app.getPath('userData'), 'anthropic-key.enc')

export async function saveApiKey(key: string) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encrypted storage is not available on this Mac, so the key was not saved.')
  }
  await writeFile(keyPath(), safeStorage.encryptString(key), { mode: 0o600 })
}

export async function loadApiKey() {
  try {
    return safeStorage.decryptString(await readFile(keyPath()))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function hasApiKey() {
  return (await loadApiKey()) !== null
}

export const removeApiKey = () => rm(keyPath(), { force: true })
