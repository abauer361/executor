import { useCallback, useState } from 'react'
import { isSecretSetting, type McpSetting } from '../../../shared/mcpServers'
import { PROVIDER_LABEL, type Provider } from '../../../shared/pricing'
import { bridge } from '../bridge'
import { packageById } from '../data/catalog'
import { serverSpec } from '../runState'
import { useApp } from '../store'
import { countOf } from '../usage'
import { Icon, Kbd } from './ui'
import { useEscape } from './useEscape'

const KEYS_PAGE = 'https://platform.claude.com/settings/keys'

export function SettingsDialog() {
  const open = useApp((state) => state.settingsOpen)
  if (!open) return null
  return <SettingsPanel />
}

const NO_FOLDERS: string[] = []

function FolderSetting({ id, setting }: { id: string; setting: McpSetting }) {
  const folders = useApp((state) => state.mcpSetups[id]?.folders[setting.key] ?? NO_FOLDERS)
  const { saveMcpFolders } = useApp.getState()
  const multiple = setting.kind === 'folders'

  const add = async () => {
    const picked = await bridge.pickFolders(multiple)
    if (picked.length) await saveMcpFolders(id, setting.key, multiple ? [...new Set([...folders, ...picked])] : picked)
  }

  return (
    <div className="setting">
      <div className="row">
        <span className="grow muted">{setting.label}</span>
        <button className="btn btn-ghost btn-mini" type="button" onClick={() => void add()}>
          <Icon name="folder_open" size={14} />
          {multiple ? 'Add Folder' : 'Choose Folder'}
        </button>
      </div>
      {folders.map((folder) => (
        <div key={folder} className="row setting-folder">
          <span className="mono grow truncate" title={folder}>
            {folder}
          </span>
          <button
            className="icon-button"
            type="button"
            aria-label={`Remove ${folder}`}
            onClick={() => void saveMcpFolders(id, setting.key, folders.filter((item) => item !== folder))}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

function SecretSetting({ id, setting }: { id: string; setting: McpSetting }) {
  const saved = useApp((state) => state.mcpSetups[id]?.secrets.includes(setting.key) ?? false)
  const { saveMcpSecret } = useApp.getState()
  const [value, setValue] = useState('')

  const save = async () => {
    await saveMcpSecret(id, setting.key, value.trim())
    setValue('')
  }

  return (
    <div className="setting">
      <span className="muted">{setting.label}</span>
      <div className="row">
        <input
          className="input"
          type="password"
          value={value}
          placeholder={saved ? 'Saved. Paste a new one to replace it' : 'Paste it here'}
          aria-label={setting.label}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && value.trim() && void save()}
        />
        <button className="btn btn-secondary" type="button" disabled={!value.trim()} onClick={() => void save()}>
          Save
        </button>
        {saved && (
          <button className="btn btn-destructive" type="button" onClick={() => void saveMcpSecret(id, setting.key, '')}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

function ServerSettings({ id }: { id: string }) {
  const check = useApp((state) => state.downloads[id]?.check)
  const checking = useApp((state) => state.mcpChecking.includes(id))
  const registry = useApp((state) => state.registryServers)

  return (
    <div className="server-settings">
      <div className="row">
        <span className="strong grow">{packageById(id, registry)?.name ?? id}</span>
        {checking && <span className="mono faint">Starting</span>}
        {!checking && check?.ok && <span className="mono muted">{countOf(check.tools ?? 0, 'tool')}</span>}
      </div>
      {serverSpec(id, registry)?.settings.map((setting) =>
        isSecretSetting(setting) ? (
          <SecretSetting key={setting.key} id={id} setting={setting} />
        ) : (
          <FolderSetting key={setting.key} id={id} setting={setting} />
        )
      )}
      {!checking && check && !check.ok && <p className="mono package-error">{check.message}</p>}
    </div>
  )
}

const KEY_PAGES: Record<Provider, { name: string; url: string }> = {
  anthropic: { name: 'Claude Console', url: 'https://platform.claude.com/settings/keys' },
  openai: { name: 'OpenAI dashboard', url: 'https://platform.openai.com/api-keys' },
  google: { name: 'Google AI Studio', url: 'https://aistudio.google.com/apikey' }
}

function ProviderKey({ provider, autoFocus }: { provider: Provider; autoFocus: boolean }) {
  const saved = useApp((state) => state.apiKeys[provider])
  const { saveApiKey, removeApiKey } = useApp.getState()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const label = PROVIDER_LABEL[provider]
  const page = KEY_PAGES[provider]

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await saveApiKey(provider, key.trim())
      if (result.ok) setKey('')
      else setError(result.message ?? 'That key did not work.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that key.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="provider-key">
      <div className="row">
        <span className="strong grow">{label}</span>
        {saved ? (
          <>
            <span className="mono muted">Saved and encrypted</span>
            <button className="btn btn-destructive btn-mini" type="button" onClick={() => void removeApiKey(provider)}>
              Remove
            </button>
          </>
        ) : (
          <button className="link mono" type="button" onClick={() => void bridge.openExternal(page.url)}>
            Create a key
          </button>
        )}
      </div>
      <div className="row">
        <input
          autoFocus={autoFocus}
          className="input"
          type="password"
          value={key}
          placeholder={saved ? 'Paste a new key to replace it' : 'Paste your API key'}
          aria-label={`${label} API key`}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setKey(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && key.trim() && void save()}
        />
        <button className="btn btn-primary" type="button" disabled={busy || !key.trim()} onClick={() => void save()}>
          {busy ? 'Checking' : 'Save Key'}
        </button>
      </div>
      {error && <p className="mono package-error">{error}</p>}
    </div>
  )
}

function SettingsPanel() {
  const downloads = useApp((state) => state.downloads)
  const registry = useApp((state) => state.registryServers)
  const { setUi } = useApp.getState()
  const configurable = Object.keys(downloads).filter((id) => (serverSpec(id, registry)?.settings.length ?? 0) > 0)

  const close = useCallback(() => setUi({ settingsOpen: false }), [setUi])
  useEscape(close)

  return (
    <div className="backdrop" onMouseDown={close} role="presentation">
      <div className="dialog" role="dialog" aria-label="Settings" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <div className="tile">
            <Icon name="key" size={18} />
          </div>
          <div className="stack">
            <span className="strong">Settings</span>
            <span className="eyebrow">Keys and MCP servers</span>
          </div>
          <Kbd>ESC</Kbd>
        </div>

        <div className="settings-body">
          <span className="eyebrow">Model providers</span>
          <p className="muted">
            Agents run through your own accounts, and runs are billed there. Keys are checked with the provider, then
            encrypted in your Mac's keychain.
          </p>
          <ProviderKey provider="anthropic" autoFocus />
          <ProviderKey provider="openai" autoFocus={false} />
          <ProviderKey provider="google" autoFocus={false} />

          {configurable.length > 0 && (
            <>
              <span className="eyebrow settings-section">MCP servers</span>
              <p className="muted">
                Agents can only reach the folders you add here. Actions that change something ask for your approval.
              </p>
              {configurable.map((id) => (
                <ServerSettings key={id} id={id} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
