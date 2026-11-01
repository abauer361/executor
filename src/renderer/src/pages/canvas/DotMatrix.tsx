import { useStore } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { useApp } from '../../store'

const SPACING = 26
const RESTING_RADIUS = 1.25
const RESTING_OPACITY = 0.14
const CURSOR_REACH = 140

// Draws only while something changes, so an idle canvas uses no CPU.
export function DotMatrix() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const transform = useStore((state) => state.transform)
  const theme = useApp((state) => state.theme)
  const scene = useRef({ transform, ink: '255, 255, 255', redraw: () => {} })

  scene.current.transform = transform
  scene.current.ink = theme === 'dark' ? '255, 255, 255' : '0, 0, 0'

  useEffect(() => {
    const canvas = canvasRef.current
    const viewport = canvas?.parentElement
    const context = canvas?.getContext('2d')
    if (!canvas || !viewport || !context) return

    const mouse = { x: -1000, y: -1000 }
    const smooth = { x: -1000, y: -1000 }
    let frame = 0

    const draw = () => {
      frame = 0
      const { width, height } = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      const [panX, panY, zoom] = scene.current.transform
      const { ink } = scene.current
      const step = SPACING * zoom

      smooth.x += (mouse.x - smooth.x) * 0.25
      smooth.y += (mouse.y - smooth.y) * 0.25

      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)

      for (let x = ((panX % step) + step) % step; x < width; x += step) {
        for (let y = ((panY % step) + step) % step; y < height; y += step) {
          const distance = Math.hypot(x - smooth.x, y - smooth.y)
          const glow = distance < CURSOR_REACH ? (1 - distance / CURSOR_REACH) ** 2 : 0
          const radius = RESTING_RADIUS + glow * 1.5
          const opacity = RESTING_OPACITY + glow * (0.92 - RESTING_OPACITY)

          if (glow > 0.45) {
            context.beginPath()
            context.arc(x, y, radius * 2.8, 0, Math.PI * 2)
            context.fillStyle = `rgba(${ink}, ${(glow * 0.18).toFixed(3)})`
            context.fill()
          }
          context.beginPath()
          context.arc(x, y, radius, 0, Math.PI * 2)
          context.fillStyle = `rgba(${ink}, ${opacity.toFixed(3)})`
          context.fill()
        }
      }

      const settling = Math.abs(mouse.x - smooth.x) + Math.abs(mouse.y - smooth.y) > 0.5
      if (settling) redraw()
    }

    const redraw = () => {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    scene.current.redraw = redraw

    const resize = () => {
      const { width, height } = viewport.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(width * ratio)
      canvas.height = Math.floor(height * ratio)
      redraw()
    }

    const onMove = (event: MouseEvent) => {
      const rect = viewport.getBoundingClientRect()
      mouse.x = event.clientX - rect.left
      mouse.y = event.clientY - rect.top
      if (smooth.x < -500) Object.assign(smooth, mouse)
      redraw()
    }

    const onLeave = () => {
      mouse.x = -1000
      mouse.y = -1000
      smooth.x = -1000
      smooth.y = -1000
      redraw()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(viewport)
    viewport.addEventListener('mousemove', onMove)
    viewport.addEventListener('mouseleave', onLeave)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      viewport.removeEventListener('mousemove', onMove)
      viewport.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  useEffect(() => scene.current.redraw(), [transform, theme])

  return <canvas ref={canvasRef} className="dot-matrix" aria-hidden="true" />
}
