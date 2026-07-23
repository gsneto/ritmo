import { useState } from 'react'
import { User } from '../App'
import { Sun, Moon, Trash2, Bell, BellOff } from 'lucide-react'
import { useNotifications } from '../hooks/useNotifications'
import { apiRoutes } from '../services/api'

interface SettingsProps {
  user: User
  users: User[]
  onUserChange: (user: User) => void
  onThemeChange: (theme: 'light' | 'dark') => void
  onDataReset?: () => void
}

export default function Settings({ user, users, onUserChange, onThemeChange, onDataReset }: SettingsProps) {
  const { permission, requestPermission, isSupported } = useNotifications()
  const [isResetting, setIsResetting] = useState(false)

  async function handleReset() {
    if (!confirm(`Limpar TODOS os dados de ${user.name}?\n\nIsso remove:\n- Todos os hábitos\n- Todas as tarefas\n- Todos os treinos\n\nEsta ação não pode ser desfeita.`)) return

    setIsResetting(true)
    try {
      await apiRoutes.resetUserData(user.id)
      if (onDataReset) onDataReset()
      alert('Dados limpos com sucesso!')
      window.location.reload()
    } catch (error) {
      console.error('Failed to reset data:', error)
      alert('Erro ao limpar dados. Tente novamente.')
    } finally {
      setIsResetting(false)
    }
  }

  async function handleNotificationPermission() {
    await requestPermission()
  }

  return (
    <div className="view" data-view="settings">
      <section className="panel settings-panel">
        <div className="panel-head">
          <div><p className="section-label">Perfis</p><h2>Quem está usando?</h2></div>
        </div>
        <div className="profile-cards">
          {users.map((u) => (
            <article
              key={u.id}
              className={`profile-card ${u.id === user.id ? 'active-profile' : ''}`}
            >
              <span className="profile-avatar">{u.initials}</span>
              <div>
                <strong>{u.name}</strong>
                <small>{u.id === user.id ? 'Perfil ativo' : ''}</small>
              </div>
              {u.id === user.id ? (
                <button className="profile-current-button" disabled type="button">
                  Em uso
                </button>
              ) : (
                <button
                  className="profile-switch-button"
                  onClick={() => onUserChange(u)}
                  type="button"
                >
                  Usar perfil
                </button>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="panel settings-panel">
        <div className="panel-head">
          <div><p className="section-label">Aparência</p><h2>Tema</h2></div>
        </div>
        <div className="theme-switch" role="group">
          <button
            type="button"
            className={user.theme === 'light' ? 'active' : ''}
            onClick={() => onThemeChange('light')}
          >
            <Sun size={18} />
            <span>Claro</span>
          </button>
          <button
            type="button"
            className={user.theme === 'dark' ? 'active' : ''}
            onClick={() => onThemeChange('dark')}
          >
            <Moon size={18} />
            <span>Escuro</span>
          </button>
        </div>
      </section>

      {isSupported && (
        <section className="panel settings-panel">
          <div className="panel-head">
            <div><p className="section-label">Notificações</p><h2>Alertas</h2></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {permission === 'granted' ? (
              <>
                <Bell size={20} style={{ color: 'var(--green)' }} />
                <span style={{ color: 'var(--green)', fontWeight: 600 }}>
                  Notificações ativadas
                </span>
              </>
            ) : permission === 'denied' ? (
              <>
                <BellOff size={20} style={{ color: 'var(--red)' }} />
                <span style={{ color: 'var(--muted)' }}>
                  Notificações bloqueadas pelo navegador
                </span>
              </>
            ) : (
              <>
                <Bell size={20} style={{ color: 'var(--muted)' }} />
                <span style={{ color: 'var(--muted)' }}>
                  Ative para receber lembretes de hábitos
                </span>
                <button className="primary-button" onClick={handleNotificationPermission} type="button">
                  Ativar
                </button>
              </>
            )}
          </div>
        </section>
      )}

      <section className="panel data-panel">
        <div className="panel-head">
          <div><p className="section-label">Dados</p><h2>Dados de {user.name}</h2></div>
        </div>
        <button
          className="danger-action"
          onClick={handleReset}
          disabled={isResetting}
          type="button"
        >
          <Trash2 size={17} />
          <span>{isResetting ? 'Limpando...' : 'Limpar dados deste perfil'}</span>
        </button>
      </section>
    </div>
  )
}
