import { app, safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Provider } from '../shared/pricing'

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

const PROVIDERS: Provider[] = ['anthropic', 'openai', 'google']
const providerSecret = (provider: Provider) => `${provider}-key`

export const saveApiKey = (provider: Provider, key: string) => saveSecret(providerSecret(provider), key)
export const removeApiKey = (provider: Provider) => removeSecret(providerSecret(provider))

export async function loadApiKeys() {
  const entries = await Promise.all(
    PROVIDERS.map(async (provider) => [provider, await loadSecret(providerSecret(provider))] as const)
  )
  return Object.fromEntries(entries.filter(([, key]) => key !== null)) as Partial<Record<Provider, string>>
}

export async function apiKeyStatus() {
  const keys = await loadApiKeys()
  return Object.fromEntries(PROVIDERS.map((provider) => [provider, Boolean(keys[provider])])) as Record<Provider, boolean>
}
