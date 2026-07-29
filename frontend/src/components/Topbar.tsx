import { Moon, Settings, Sun } from 'lucide-react'
import type { User } from '../services/api'

interface TopbarProps {
  user: User
  onSettingsClick: () => void
  onThemeChange: (theme: 'light' | 'dark') => void
}

export default function Topbar({
  user,
  onSettingsClick,
  onThemeChange,
}: TopbarProps) {
  const firstName = user.name.trim().split(/\s+/)[0] || 'você'

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
        <button
          className="topbar-settings-button"
          onClick={onSettingsClick}
          type="button"
          aria-label="Abrir ajustes"
          title="Ajustes"
        >
          <Settings size={20} aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
