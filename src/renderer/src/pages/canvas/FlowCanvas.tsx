import {
  BaseEdge,
  getBezierPath,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes
} from '@xyflow/react'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { NodeRun, WorkflowEdge, WorkflowNode } from '../../../../shared/types'
import { Icon, Kbd, RobotFace, StatusDot } from '../../components/ui'
import { costOf, formatDollars, formatTokens, tokenLimit } from '../../sim'
import { activeWorkflow, useApp } from '../../store'
import { DotMatrix } from './DotMatrix'

export const AGENT_DRAG_TYPE = 'application/x-executor-agent'
export const FIT_OPTIONS = { maxZoom: 1, padding: 0.12 }

const NEAR_LIMIT = 0.8

export const dropPosition = (point: { x: number; y: number }) => ({ x: point.x - 90, y: point.y - 56 })

type FlowEdge = Edge<{ pulse: boolean }, 'flow'>

function AgentNode({ data, selected }: NodeProps<Node<NodeRun, 'agent'>>) {
  const agent = useApp((state) => state.agents.find((candidate) => candidate.id === data.agentId))
  if (!agent) return null

  const limit = tokenLimit(agent.limiter)
  const share = Math.min(1, limit ? data.tokensUsed / limit : 1)
  const near = share >= NEAR_LIMIT
  const usedLabel = formatTokens(data.tokensUsed)
  const cost = formatDollars(costOf(data.tokensUsed))
  const amber = data.status === 'warning' || near

  return (
    <div className={`node ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-head">
        <div className={`tile node-face ${data.status === 'warning' ? 'is-warning' : ''}`}>
          <RobotFace face={agent.face} />
        </div>
        <div className="stack grow">
          <span className="node-title truncate">{agent.name}</span>
          <span
            className={`node-task ${data.status === 'stopped' ? '' : 'truncate'} ${
              data.status === 'warning' ? 'is-warning' : ''
            }`}
          >
            {data.task}
          </span>
        </div>
        <StatusDot status={data.status} />
      </div>
      <div className={`node-usage ${amber ? 'is-warning' : ''}`}>
        <div className="meter">
          <span style={{ width: `${Math.round(share * 100)}%` }} />
        </div>
        <div className="node-usage-row">
          {agent.limiter.mode === 'tokens' ? (
            <>
              <span>
                {usedLabel} / {formatTokens(limit)}
              </span>
              <span>{cost}</span>
            </>
          ) : (
            <>
              <span>{usedLabel}</span>
              <span>
                {cost} / ${agent.limiter.dollars}
              </span>
            </>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function FlowEdgeView({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data
}: EdgeProps<FlowEdge>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  return (
    <>
      <BaseEdge path={path} className={selected ? 'is-selected' : ''} />
      {data?.pulse && (
        <circle className="edge-pulse" r="3">
          <animateMotion dur="2.4s" path={path} repeatCount="indefinite" />
        </circle>
      )}
    </>
  )
}

const nodeTypes: NodeTypes = { agent: AgentNode }
const edgeTypes: EdgeTypes = { flow: FlowEdgeView }

export function FlowCanvas() {
  const workflow = useApp(activeWorkflow)
  const drawerOpen = useApp((state) => state.drawerOpen)
  const drawerTab = useApp((state) => state.drawerTab)
  const inspectorOpen = useApp((state) => state.inspectorOpen)
  const { applyNodes, applyEdges, connect, addAgentNode, setUi } = useApp.getState()
  const logsOpen = useApp((state) => state.logsOpen)
  const { screenToFlowPosition, fitView } = useReactFlow()
  const [dropping, setDropping] = useState(false)
  const firstLayout = useRef(true)

  // Panels change the canvas size, so re-fit to keep every node in view.
  const panels = `${drawerOpen}-${inspectorOpen}-${logsOpen}`
  useEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false
      return
    }
    const timer = setTimeout(() => void fitView({ ...FIT_OPTIONS, duration: 200 }), 60)
    return () => clearTimeout(timer)
  }, [panels, fitView])

  const edges = useMemo<FlowEdge[]>(() => {
    const running = new Set(workflow.nodes.filter((node) => node.data.status === 'active').map((node) => node.id))
    return workflow.edges.map((edge) => ({ ...edge, type: 'flow', data: { pulse: running.has(edge.source) } }))
  }, [workflow.nodes, workflow.edges])

  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes(AGENT_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDropping(true)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDropping(false)
    const agentId = event.dataTransfer.getData(AGENT_DRAG_TYPE)
    if (!agentId) return
    addAgentNode(agentId, dropPosition(screenToFlowPosition({ x: event.clientX, y: event.clientY })))
  }

  return (
    <div
      className={`viewport ${dropping ? 'is-dropping' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <DotMatrix />
      <ReactFlow<WorkflowNode, FlowEdge>
        nodes={workflow.nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={applyNodes}
        onEdgesChange={(changes) => applyEdges(changes as EdgeChange<WorkflowEdge>[])}
        onConnect={connect}
        isValidConnection={(connection) => connection.source !== connection.target}
        onNodeClick={() => setUi({ inspectorOpen: true })}
        fitView
        fitViewOptions={FIT_OPTIONS}
        minZoom={0.4}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={['Backspace', 'Delete']}
      />

      {workflow.nodes.length === 0 && (
        <p className="canvas-empty">Drag an agent here from the Agents tab to start this workflow.</p>
      )}

      {!drawerOpen && (
        <button
          className="float float-top-left"
          type="button"
          onClick={() => setUi({ drawerOpen: true })}
        >
          <Icon name="view_sidebar" />
          {drawerTab === 'agents' ? 'Agents' : 'Workflows'}
        </button>
      )}

      {!inspectorOpen && (
        <button className="float float-top-right" type="button" onClick={() => setUi({ inspectorOpen: true })}>
          Inspector
          <Icon name="dock_to_left" />
        </button>
      )}

      <button
        className="float float-bottom-right"
        type="button"
        onClick={() => setUi({ drawerOpen: true, drawerTab: 'workflows', creatingWorkflow: true })}
      >
        <Icon name="add" />
        New Canvas
        <Kbd>⌘N</Kbd>
      </button>
    </div>
  )
}
