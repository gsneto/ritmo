import { Activity, Settings } from 'lucide-react'
import type { User } from '../services/api'

interface TopbarProps {
  user: User
  onSettingsClick: () => void
}

export default function Topbar({ user, onSettingsClick }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Activity size={21} strokeWidth={2.4} />
        </span>
        <div>
          <p className="eyebrow">Rotina pessoal</p>
          <h1>Ritmo</h1>
        </div>
      </div>
      <button className="profile-button" onClick={onSettingsClick} type="button" aria-label="Abrir ajustes de perfil">
        <span className="profile-avatar" aria-hidden="true">{user.initials}</span>
        <span className="profile-name">{user.name}</span>
        <Settings size={17} aria-hidden="true" />
      </button>
    </header>
  )
}
