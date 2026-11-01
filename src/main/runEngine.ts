import { outputAllowance, usageCost } from '../shared/pricing'
import { incomingByNode } from '../shared/runGraph'
import type { AgentStatus, RunEvent, RunNodeSpec, RunOutcome, RunRequest } from '../shared/types'

const MAX_PARALLEL_AGENTS = 3
const MAX_OUTPUT_TOKENS = 64_000
const MIN_USEFUL_OUTPUT_TOKENS = 256
const PROGRESS_INTERVAL_MS = 150

// Only used for the live meter. Billed usage replaces it when the agent finishes.
const CHARS_PER_TOKEN = 4

export interface ModelPrompt {
  model: string
  system: string
  userMessage: string
}

export type ModelProgress =
  | { type: 'phase'; phase: 'thinking' | 'writing' }
  | { type: 'thinking'; chars: number }
  | { type: 'text'; text: string }

export interface ModelUsage {
  model: string
  inputTokens: number
  outputTokens: number
}

export interface ModelResult {
  text: string
  stopReason: string | null
  usage: ModelUsage[]
}

export interface ModelClient {
  countInputTokens(prompt: ModelPrompt, signal: AbortSignal): Promise<number>
  stream(
    prompt: ModelPrompt,
    maxTokens: number,
    signal: AbortSignal,
    onProgress: (progress: ModelProgress) => void
  ): Promise<ModelResult>
}

// An error that every agent would hit, such as a rejected API key.
export class FatalRunError extends Error {}

export interface RunHandle {
  stop(): void
  inject(nodeId: string, text: string): void
  done: Promise<void>
}

type NodeOutcome = 'completed' | 'halted' | 'failed' | 'stopped' | 'skipped'

const totalTokens = (usage: ModelUsage[]) =>
  usage.reduce((sum, entry) => sum + entry.inputTokens + entry.outputTokens, 0)

const totalCost = (usage: ModelUsage[]) =>
  usage.reduce((sum, entry) => sum + usageCost(entry.model, entry.inputTokens, entry.outputTokens), 0)

export function buildSystemPrompt(node: Pick<RunNodeSpec, 'name' | 'prompt'>) {
  const role = `You are running as the ${node.name} agent in a multi-agent workflow. Your reply goes to the next agents in the workflow, or to the user if you are the last.`
  const limits =
    'You have no tools in this run: you cannot read files, run commands, browse or call services. Work only from what you are given here, and say plainly what you could not check.'
  return [node.prompt.trim(), role, limits].filter(Boolean).join('\n\n')
}

export function buildUserMessage(goal: string, upstream: { name: string; output: string }[], instructions: string[]) {
  const sections = [`Goal:\n${goal}`]
  for (const { name, output } of upstream) {
    sections.push(`<upstream_output agent="${name.replaceAll('"', '')}">\n${output}\n</upstream_output>`)
  }
  if (instructions.length) {
    sections.push(`Extra instructions from the user:\n${instructions.map((line) => `- ${line}`).join('\n')}`)
  }
  sections.push('Do your part of this goal and reply with your result.')
  return sections.join('\n\n')
}

export function launchRun(request: RunRequest, client: ModelClient, emit: (event: RunEvent) => void): RunHandle {
  const controller = new AbortController()
  const { signal } = controller
  const { runId, goal, nodes, edges } = request
  const instructions = new Map(nodes.map((node) => [node.id, [...node.instructions]]))
  const outputs = new Map<string, string>()
  const outcomes = new Map<string, NodeOutcome>()
  const incoming = incomingByNode(
    nodes.map((node) => node.id),
    edges
  )
  const byId = new Map(nodes.map((node) => [node.id, node]))
  let fatal: string | null = null

  const setNode = (node: RunNodeSpec, status: AgentStatus, task: string) =>
    emit({ type: 'node', runId, nodeId: node.id, status, task })
  const log = (node: RunNodeSpec, message: string) =>
    emit({ type: 'log', runId, nodeId: node.id, agent: node.name, message })

  async function runNode(node: RunNodeSpec): Promise<NodeOutcome> {
    setNode(node, 'active', 'Preparing')
    const upstream = (incoming.get(node.id) ?? []).map((id) => ({
      name: byId.get(id)?.name ?? id,
      output: outputs.get(id) ?? ''
    }))
    const prompt: ModelPrompt = {
      model: node.model,
      system: buildSystemPrompt(node),
      userMessage: buildUserMessage(goal, upstream, instructions.get(node.id) ?? [])
    }
    const limitMessage = node.limiter.mode === 'tokens' ? 'Token budget exceeded' : 'Dollar limit reached'

    const inputTokens = await client.countInputTokens(prompt, signal)
    const allowance = outputAllowance(node.limiter, node.model, inputTokens)
    if (allowance < MIN_USEFUL_OUTPUT_TOKENS) {
      setNode(node, 'stopped', limitMessage)
      log(node, `${limitMessage}: ${inputTokens} input tokens leave too little to reply, so nothing was spent`)
      return 'halted'
    }

    log(node, `Started on ${node.model}`)
    const maxTokens = Math.min(MAX_OUTPUT_TOKENS, allowance)
    let text = ''
    let streamedChars = 0
    let lastFlush = 0

    const flush = () => {
      const estimatedOutput = Math.ceil(streamedChars / CHARS_PER_TOKEN)
      emit({
        type: 'usage',
        runId,
        nodeId: node.id,
        tokens: inputTokens + estimatedOutput,
        cost: usageCost(node.model, inputTokens, estimatedOutput)
      })
      emit({ type: 'output', runId, nodeId: node.id, text })
    }

    const result = await client.stream(prompt, maxTokens, signal, (progress) => {
      if (progress.type === 'phase') {
        setNode(node, 'active', progress.phase === 'thinking' ? 'Thinking' : 'Writing')
        return
      }
      if (progress.type === 'text') text += progress.text
      streamedChars += progress.type === 'text' ? progress.text.length : progress.chars
      if (Date.now() - lastFlush >= PROGRESS_INTERVAL_MS) {
        lastFlush = Date.now()
        flush()
      }
    })

    emit({ type: 'output', runId, nodeId: node.id, text: result.text })
    emit({
      type: 'usage',
      runId,
      nodeId: node.id,
      tokens: totalTokens(result.usage),
      cost: totalCost(result.usage)
    })

    if (result.stopReason === 'refusal') {
      setNode(node, 'stopped', 'Declined by Claude')
      log(node, 'Claude declined this request, so its partial output was not passed on')
      return 'failed'
    }
    if (result.stopReason === 'max_tokens' && maxTokens < MAX_OUTPUT_TOKENS) {
      setNode(node, 'stopped', limitMessage)
      log(node, `${limitMessage}, agent halted`)
      return 'halted'
    }
    if (result.stopReason === 'max_tokens') log(node, 'Reply reached the maximum length and was cut off')

    outputs.set(node.id, result.text)
    setNode(node, 'idle', 'Done')
    log(node, 'Finished')
    return 'completed'
  }

  async function settleNode(node: RunNodeSpec): Promise<NodeOutcome> {
    try {
      return await runNode(node)
    } catch (error) {
      if (signal.aborted && fatal === null) {
        setNode(node, 'idle', 'Stopped')
        return 'stopped'
      }
      if (error instanceof FatalRunError) {
        fatal = error.message
        controller.abort()
      }
      const message = error instanceof Error ? error.message : 'Unknown error'
      setNode(node, 'stopped', 'Failed')
      log(node, `Failed: ${message}`)
      return 'failed'
    }
  }

  function schedule() {
    return new Promise<void>((resolve) => {
      const waiting = new Set(nodes.map((node) => node.id))
      let running = 0

      const skip = (node: RunNodeSpec, task: string) => {
        waiting.delete(node.id)
        outcomes.set(node.id, 'skipped')
        setNode(node, 'idle', task)
      }

      const pump = () => {
        for (let changed = true; changed; ) {
          changed = false
          for (const id of [...waiting]) {
            const node = byId.get(id)!
            const sources = incoming.get(id) ?? []
            const blockedBy = sources.find((source) => outcomes.has(source) && outcomes.get(source) !== 'completed')

            if (signal.aborted) {
              skip(node, 'Stopped')
              changed = true
            } else if (blockedBy) {
              skip(node, 'Skipped')
              log(node, `Skipped because ${byId.get(blockedBy)?.name ?? 'an earlier agent'} did not finish`)
              changed = true
            } else if (running < MAX_PARALLEL_AGENTS && sources.every((source) => outcomes.has(source))) {
              waiting.delete(id)
              running += 1
              void settleNode(node).then((outcome) => {
                outcomes.set(id, outcome)
                running -= 1
                pump()
              })
            }
          }
        }
        if (waiting.size === 0 && running === 0) resolve()
      }

      pump()
    })
  }

  function runOutcome(): RunOutcome {
    if (fatal !== null) return 'failed'
    if (signal.aborted) return 'stopped'
    const results = [...outcomes.values()]
    if (results.includes('failed')) return 'failed'
    return results.includes('halted') ? 'halted' : 'completed'
  }

  async function execute() {
    for (const node of nodes) setNode(node, 'queued', 'Queued')
    await schedule()
    emit({ type: 'end', runId, outcome: runOutcome(), message: fatal ?? undefined })
  }

  return {
    stop: () => controller.abort(),
    inject: (nodeId, text) => void instructions.get(nodeId)?.push(text),
    done: execute()
  }
}
