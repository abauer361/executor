import { useState } from 'react'
import { bridge } from '../bridge'
import { useApp } from '../store'
import { Icon, Kbd } from './ui'

const KEYS_PAGE = 'https://platform.claude.com/settings/keys'

export function SettingsDialog() {
  const open = useApp((state) => state.settingsOpen)
  if (!open) return null
  return <SettingsPanel />
}

function SettingsPanel() {
  const hasApiKey = useApp((state) => state.hasApiKey)
  const { saveApiKey, removeApiKey, setUi } = useApp.getState()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const close = () => setUi({ settingsOpen: false })

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await saveApiKey(key.trim())
      if (result.ok) setKey('')
      else setError(result.message ?? 'That key did not work.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that key.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="backdrop"
      onMouseDown={close}
      onKeyDown={(event) => event.key === 'Escape' && close()}
      role="presentation"
    >
      <div className="dialog" role="dialog" aria-label="Settings" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <div className="tile">
            <Icon name="key" size={18} />
          </div>
          <div className="stack">
            <span className="strong">Settings</span>
            <span className="eyebrow">Anthropic API key</span>
          </div>
          <Kbd>ESC</Kbd>
        </div>

        <div className="settings-body">
          {hasApiKey && (
            <div className="row">
              <Icon name="check" size={15} />
              <span className="grow">A key is saved, encrypted in your Mac's keychain.</span>
              <button className="btn btn-destructive" type="button" onClick={() => void removeApiKey()}>
                Remove
              </button>
            </div>
          )}

          <p className="muted">
            Agents run through your own Anthropic account, and runs are billed there. Create a key on the{' '}
            <button className="link" type="button" onClick={() => void bridge.openExternal(KEYS_PAGE)}>
              Claude Console
            </button>
            .
          </p>

          <div className="row">
            <input
              autoFocus
              className="input"
              type="password"
              value={key}
              placeholder={hasApiKey ? 'Paste a new key to replace it' : 'Paste your API key'}
              aria-label="Anthropic API key"
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
      </div>
    </div>
  )
}
