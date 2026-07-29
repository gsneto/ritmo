import { Settings } from 'lucide-react'
import type { User } from '../services/api'

interface TopbarProps {
  user: User
  onSettingsClick: () => void
}

export default function Topbar({ user, onSettingsClick }: TopbarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark brand-mark-grafismo" aria-hidden="true">
          <img src="/grafismo-indigena-ritmo.png" alt="" />
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
