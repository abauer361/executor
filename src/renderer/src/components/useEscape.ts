import { useEffect } from 'react'

// Listens on the window so Escape still works after focus is lost, such as when a button disables itself.
export function useEscape(onEscape: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onEscape])
}
