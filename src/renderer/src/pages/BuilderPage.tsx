import { useEffect, useState } from 'react'
import { RUNNABLE_MODELS } from '../../../shared/pricing'
import type { Agent, MemoryDoc, PackageKind } from '../../../shared/types'
import { bridge } from '../bridge'
import { Icon, RobotFace } from '../components/ui'
import { CATALOG, packageById } from '../data/catalog'
import { MODELS } from '../data/models'
import { useApp } from '../store'
import { agentSummary } from '../usage'

const TOKEN_PRESETS = [25_000, 50_000, 100_000, 250_000, 500_000]
const DOLLAR_PRESETS = [1, 5, 10, 25, 50]

function formatSize(bytes: number) {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1000))} KB`
}

function AgentList({ draft }: { draft: Agent | null }) {
  const agents = useApp((state) => state.agents)
  const { openBuilder, createAgent } = useApp.getState()
  const [query, setQuery] = useState('')
  const visible = agents.filter((agent) => agent.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <aside className="drawer">
      <div className="drawer-pad">
        <div className="field-icon">
          <Icon name="search" />
          <input
            className="input"
            value={query}
            placeholder="Search agents..."
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <div className="drawer-pad drawer-rule">
        <button className="btn btn-secondary btn-block" type="button" onClick={createAgent}>
          <Icon name="add" />
          New Agent
        </button>
      </div>
      <div className="drawer-scroll">
        <div className="section-label">
          <span className="eyebrow">Agents</span>
          <span className="chip">{agents.length} Total</span>
        </div>
        <div className="list">
          {visible.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={`list-card ${agent.id === draft?.id ? 'is-active' : ''}`}
              onClick={() => openBuilder(agent.id)}
            >
              <span className="row">
                <RobotFace face={agent.face} size={16} />
                <span className="list-title truncate">{agent.name}</span>
                {agent.source === 'downloaded' && <span className="chip">Downloaded</span>}
              </span>
              <span className="agent-row-meta truncate">{agentSummary(agent)}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}

function Section({
  id,
  title,
  count,
  action,
  children
}: {
  id?: string
  title: string
  count?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section id={id} className="form-section">
      <div className="form-section-head">
        <span className="row">
          <span className="eyebrow">{title}</span>
          {count && <span className="chip">{count}</span>}
        </span>
        {action}
      </div>
      {children}
    </section>
  )
}

function ModelPool({ draft }: { draft: Agent }) {
  const { updateDraft } = useApp.getState()

  const toggle = (id: string) =>
    updateDraft({
      models: draft.models.includes(id) ? draft.models.filter((model) => model !== id) : [...draft.models, id]
    })

  return (
    <Section title="Active Models" count={`${draft.models.length} Enabled`}>
      <div className="model-grid">
        {MODELS.map((model) => {
          const checked = draft.models.includes(model.id)
          return (
            <label key={model.id} className={`model-card ${checked ? 'is-on' : ''}`}>
              <span className="row">
                <span className="chip grow-chip">{model.tier}</span>
                <input className="check" type="checkbox" checked={checked} onChange={() => toggle(model.id)} />
              </span>
              <span className="strong truncate">{model.name}</span>
              <span className="mono faint">
                {RUNNABLE_MODELS.includes(model.id) ? model.focus : 'Not connected yet'}
              </span>
            </label>
          )
        })}
      </div>
      <p className="note">
        <Icon name="auto_awesome" size={15} />
        Runs use the model picked in the Inspector, or the first Claude model here. Automatic routing between models
        is not built yet.
      </p>
    </Section>
  )
}

function LimiterEditor({ draft }: { draft: Agent }) {
  const { updateDraft } = useApp.getState()
  const { limiter } = draft
  const isTokens = limiter.mode === 'tokens'
  const value = isTokens ? limiter.tokens : limiter.dollars
  const presets = isTokens ? TOKEN_PRESETS : DOLLAR_PRESETS

  const setValue = (next: number) =>
    updateDraft({ limiter: { ...limiter, [isTokens ? 'tokens' : 'dollars']: next } })

  return (
    <Section
      title="Run & Cost Limiter"
      action={
        <div className="segmented" role="radiogroup" aria-label="Limiter mode">
          {(['tokens', 'dollars'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={limiter.mode === mode}
              className={limiter.mode === mode ? 'is-on' : ''}
              onClick={() => updateDraft({ limiter: { ...limiter, mode } })}
            >
              <Icon name={mode === 'tokens' ? 'toll' : 'payments'} size={14} />
              {mode === 'tokens' ? 'Tokens' : 'Dollars ($)'}
            </button>
          ))}
        </div>
      }
    >
      <div className="form-card">
        <div className="limit-input">
          <input
            className="input mono-input"
            type="number"
            min={0}
            step={isTokens ? 1000 : 0.5}
            value={value}
            aria-label={isTokens ? 'Token limit per run' : 'Dollar limit per run'}
            onChange={(event) => setValue(Math.max(0, Number(event.target.value)))}
          />
          <span className="mono faint">{isTokens ? 'TOKENS / RUN' : 'USD / RUN'}</span>
        </div>
        <div className="presets">
          <span className="mono faint">Presets</span>
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`preset ${preset === value ? 'is-on' : ''}`}
              onClick={() => setValue(preset)}
            >
              {isTokens ? `${preset / 1000}k` : `$${preset}`}
            </button>
          ))}
          <span className="mono faint presets-hint">The agent halts when it reaches this limit.</span>
        </div>
      </div>
    </Section>
  )
}

function AttachButton({
  draft,
  kind,
  label,
  field
}: {
  draft: Agent
  kind: PackageKind
  label: string
  field: 'mcpServers' | 'skills'
}) {
  const downloads = useApp((state) => state.downloads)
  const { updateDraft, setPage } = useApp.getState()
  const [open, setOpen] = useState(false)

  const available = CATALOG.filter(
    (pkg) => pkg.kind === kind && downloads[pkg.id] && !draft[field].includes(pkg.id)
  )

  return (
    <div
      className="attach"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
    >
      <button className="btn btn-ghost" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="add" size={14} />
        {label}
      </button>
      {open && (
        <div className="popover">
          {available.map((pkg) => (
            <button
              key={pkg.id}
              type="button"
              className="popover-item"
              onClick={() => {
                updateDraft({ [field]: [...draft[field], pkg.id] })
                setOpen(false)
              }}
            >
              <span className="strong">{pkg.name}</span>
              <span className="mono faint truncate">{pkg.summary}</span>
            </button>
          ))}
          {available.length === 0 && <p className="empty">Nothing else is downloaded.</p>}
          <button className="popover-foot" type="button" onClick={() => setPage('marketplace')}>
            <Icon name="extension" size={14} />
            Browse Agent Marketplace
          </button>
        </div>
      )}
    </div>
  )
}

function AttachedList({ draft, field, emptyText }: { draft: Agent; field: 'mcpServers' | 'skills'; emptyText: string }) {
  const downloads = useApp((state) => state.downloads)
  const { updateDraft } = useApp.getState()
  const ids = draft[field]

  if (ids.length === 0) return <p className="form-empty">{emptyText}</p>

  return (
    <div className={field === 'skills' ? 'attached-grid' : 'attached-list'}>
      {ids.map((id) => {
        const pkg = packageById(id)
        return (
          <div key={id} className="attached">
            <span className="stack grow">
              <span className="row">
                <span className="strong truncate">{pkg?.name ?? id}</span>
                {!downloads[id] && <span className="badge badge-warning">Not downloaded</span>}
              </span>
              <span className="mono faint truncate">{pkg?.summary}</span>
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label={`Remove ${pkg?.name ?? id}`}
              onClick={() => updateDraft({ [field]: ids.filter((item) => item !== id) })}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function MemoryDocs({ draft }: { draft: Agent }) {
  const { updateDraft } = useApp.getState()

  const attach = async () => {
    const picked = await bridge.pickDocs()
    const added: MemoryDoc[] = picked
      .filter((doc) => !draft.memory.some((existing) => existing.path === doc.path))
      .map((doc) => ({ ...doc, id: crypto.randomUUID() }))
    if (added.length) updateDraft({ memory: [...draft.memory, ...added] })
  }

  return (
    <Section
      id="section-memory"
      title="Memory & Knowledge Docs"
      count={`${draft.memory.length} Attached`}
      action={
        <button className="btn btn-ghost" type="button" onClick={() => void attach()}>
          <Icon name="attach_file" size={14} />
          Attach Docs
        </button>
      }
    >
      {draft.memory.length === 0 ? (
        <p className="form-empty">No docs attached. Attach files this agent should keep as long-term context.</p>
      ) : (
        <div className="doc-list">
          {draft.memory.map((doc) => (
            <div key={doc.id} className="doc-row">
              <Icon name="description" />
              <span className="mono grow truncate doc-name" title={doc.path}>
                {doc.name}
              </span>
              <span className="mono faint">{formatSize(doc.size)}</span>
              <button
                className="icon-button"
                type="button"
                aria-label={`Remove ${doc.name}`}
                onClick={() => updateDraft({ memory: draft.memory.filter((item) => item.id !== doc.id) })}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

export function BuilderPage() {
  const draft = useApp((state) => state.builderDraft)
  const saved = useApp((state) => state.agents.find((agent) => agent.id === state.builderDraft?.id))
  const section = useApp((state) => state.builderSection)
  const { updateDraft, saveDraft, deleteAgent, setUi, createAgent } = useApp.getState()

  useEffect(() => {
    if (!section) return
    document.getElementById(`section-${section}`)?.scrollIntoView({ block: 'start' })
    setUi({ builderSection: null })
  }, [section, setUi])

  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved))
  const problem = !draft
    ? null
    : !draft.name.trim()
      ? 'Name the agent to save it.'
      : draft.models.length === 0
        ? 'Select at least one model.'
        : (draft.limiter.mode === 'tokens' ? draft.limiter.tokens : draft.limiter.dollars) <= 0
          ? 'Set a limit above zero.'
          : null

  return (
    <>
      <div className="ribbon">
        <div className="row">
          <span className="eyebrow">Agents</span>
          <span className="faint">/</span>
          <span className="mono strong">{draft?.name || 'New agent'}</span>
          {draft && <span className="chip">{dirty ? 'Unsaved' : 'Saved'}</span>}
        </div>
        {draft && (
          <div className="row">
            {problem && <span className="mono warning-text">{problem}</span>}
            <button className="btn btn-destructive" type="button" onClick={() => deleteAgent(draft.id)}>
              Delete
            </button>
            <button className="btn btn-primary" type="button" disabled={!dirty || Boolean(problem)} onClick={saveDraft}>
              <Icon name="save" />
              Save Agent
            </button>
          </div>
        )}
      </div>

      <div className="workbench">
        <AgentList draft={draft} />
        {!draft ? (
          <div className="page-empty">
            <p className="muted">No agent selected.</p>
            <button className="btn btn-primary" type="button" onClick={createAgent}>
              <Icon name="add" />
              New Agent
            </button>
          </div>
        ) : (
          <div className="page-scroll">
            <div className="form" key={draft.id}>
              <section className="form-section identity">
                <input
                  className="title-input"
                  value={draft.name}
                  placeholder="Agent name"
                  aria-label="Agent name"
                  onChange={(event) => updateDraft({ name: event.target.value })}
                />
                <input
                  className="subtitle-input"
                  value={draft.description}
                  placeholder="Add a short description of what this agent does..."
                  aria-label="Agent description"
                  onChange={(event) => updateDraft({ description: event.target.value })}
                />
              </section>

              <ModelPool draft={draft} />
              <LimiterEditor draft={draft} />

              <Section id="section-prompt" title="System Prompt">
                <div className="prompt-box">
                  <div className="prompt-head mono">
                    <span>system_prompt.md</span>
                    <span className="faint">{draft.prompt.length} chars</span>
                  </div>
                  <textarea
                    className="prompt-input"
                    rows={8}
                    spellCheck={false}
                    value={draft.prompt}
                    placeholder="Tell this agent what it does and how it should work."
                    aria-label="System prompt"
                    onChange={(event) => updateDraft({ prompt: event.target.value })}
                  />
                </div>
              </Section>

              <Section
                id="section-mcp"
                title="MCP Servers"
                count={`${draft.mcpServers.length} Connected`}
                action={<AttachButton draft={draft} kind="mcp" label="Add MCP Server" field="mcpServers" />}
              >
                <AttachedList draft={draft} field="mcpServers" emptyText="No MCP servers connected." />
              </Section>

              <Section
                id="section-skills"
                title="Skills"
                count={`${draft.skills.length} Enabled`}
                action={<AttachButton draft={draft} kind="skill" label="Add Skill" field="skills" />}
              >
                <AttachedList draft={draft} field="skills" emptyText="No skills enabled." />
              </Section>

              <MemoryDocs draft={draft} />
            </div>
          </div>
        )}
      </div>
    </>
  )
}
