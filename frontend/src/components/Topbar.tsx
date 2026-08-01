import { BarChart3, BookOpen, Dumbbell, Menu, Moon, Settings, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { User } from '../services/api'

type HeaderMenuDestination = '/workouts' | '/reading' | '/progress' | '/settings'

interface TopbarProps {
  user: User
  onMenuNavigate: (destination: HeaderMenuDestination) => void
  onThemeChange: (theme: 'light' | 'dark') => void
}

export default function Topbar({
  user,
  onMenuNavigate,
  onThemeChange,
}: TopbarProps) {
  const firstName = user.name.trim().split(/\s+/)[0] || 'você'
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isMenuOpen) return

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false)
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsMenuOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isMenuOpen])

  function navigateFromMenu(destination: HeaderMenuDestination) {
    setIsMenuOpen(false)
    onMenuNavigate(destination)
  }

  return (
    <header className="topbar">
      <div className="topbar-greeting">
        <h1>Olá, <span>{firstName}!</span></h1>
        <span className="topbar-greeting-emoji" aria-hidden="true">🏹</span>
      </div>
      <div className="topbar-actions">
        <div className="topbar-theme-switch" role="group" aria-label="Escolher tema">
          <button
            className={user.theme === 'light' ? 'is-active' : ''}
            type="button"
            onClick={() => onThemeChange('light')}
            aria-label="Usar tema claro"
            aria-pressed={user.theme === 'light'}
            title="Tema claro"
          >
            <Sun size={19} aria-hidden="true" />
          </button>
          <button
            className={user.theme === 'dark' ? 'is-active' : ''}
            type="button"
            onClick={() => onThemeChange('dark')}
            aria-label="Usar tema escuro"
            aria-pressed={user.theme === 'dark'}
            title="Tema escuro"
          >
            <Moon size={19} aria-hidden="true" />
          </button>
        </div>
        <div className="topbar-menu" ref={menuRef}>
          <button
            className="topbar-menu-button"
            onClick={() => setIsMenuOpen(current => !current)}
            type="button"
            aria-label="Abrir mais opções"
            aria-controls="topbar-more-options"
            aria-expanded={isMenuOpen}
            title="Mais opções"
          >
            <Menu size={21} aria-hidden="true" strokeWidth={2.4} />
          </button>
          {isMenuOpen && (
            <div
              id="topbar-more-options"
              className="topbar-menu-popover"
              role="menu"
              aria-label="Mais opções"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => navigateFromMenu('/workouts')}
              >
                <Dumbbell size={18} aria-hidden="true" />
                <span>Treinos</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => navigateFromMenu('/reading')}
              >
                <BookOpen size={18} aria-hidden="true" />
                <span>Leitura</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => navigateFromMenu('/progress')}
              >
                <BarChart3 size={18} aria-hidden="true" />
                <span>Evolução</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => navigateFromMenu('/settings')}
              >
                <Settings size={18} aria-hidden="true" />
                <span>Configurações</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
