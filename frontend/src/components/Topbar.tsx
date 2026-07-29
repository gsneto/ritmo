import { Settings } from 'lucide-react'
import type { User } from '../services/api'

interface TopbarProps {
  user: User
  onSettingsClick: () => void
}

export default function Topbar({ user, onSettingsClick }: TopbarProps) {
  const firstName = user.name.trim().split(/\s+/)[0] || 'você'

  return (
    <header className="topbar">
      <div className="topbar-greeting">
        <h1>Olá, <span>{firstName}!</span></h1>
      </div>
      <button className="topbar-settings-button" onClick={onSettingsClick} type="button" aria-label="Abrir ajustes">
        <Settings size={20} aria-hidden="true" />
      </button>
    </header>
  )
}
