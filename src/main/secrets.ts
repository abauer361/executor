import { app, safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const secretPath = (name: string) => join(app.getPath('userData'), `${name}.enc`)

export async function saveSecret(name: string, value: string) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encrypted storage is not available on this Mac, so it was not saved.')
  }
  await writeFile(secretPath(name), safeStorage.encryptString(value), { mode: 0o600 })
}

export async function loadSecret(name: string) {
  try {
    return safeStorage.decryptString(await readFile(secretPath(name)))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export const removeSecret = (name: string) => rm(secretPath(name), { force: true })

const API_KEY = 'anthropic-key'

export const saveApiKey = (key: string) => saveSecret(API_KEY, key)
export const loadApiKey = () => loadSecret(API_KEY)
export const removeApiKey = () => removeSecret(API_KEY)
export const hasApiKey = async () => (await loadApiKey()) !== null
