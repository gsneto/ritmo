import { useState } from 'react'
import type { FormEvent } from 'react'
import { Activity, KeyRound } from 'lucide-react'
import type { PublicProfile } from '../services/api'

interface LoginGateProps {
  profiles: PublicProfile[]
  message?: string
  initialProfileId?: string
  onSubmit: (profileId: string, password: string) => Promise<void>
}

export default function LoginGate({
  profiles,
  message,
  initialProfileId,
  onSubmit,
}: LoginGateProps) {
  const [profileId, setProfileId] = useState(
    initialProfileId || profiles[0]?.login_id || '',
  )
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedPassword = password
    if (!profileId || !trimmedPassword || isSubmitting) return

    setIsSubmitting(true)
    try {
      await onSubmit(profileId, trimmedPassword)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="access-shell">
      <section className="panel access-panel" aria-labelledby="access-title">
        <span className="brand-mark access-mark" aria-hidden="true">
          <Activity size={24} />
        </span>
        <div className="access-copy">
          <p className="section-label">Ritmo da casa</p>
          <h1 id="access-title">Entre no seu perfil</h1>
          <p>Cada perfil tem a sua própria senha. A sessão fica neste aparelho.</p>
        </div>
        <form className="entry-form" onSubmit={handleSubmit}>
          <label htmlFor="login-profile">
            Perfil
            <select
              id="login-profile"
              value={profileId}
              onChange={event => setProfileId(event.target.value)}
              required
            >
              {profiles.map(profile => (
                <option key={profile.login_id} value={profile.login_id}>
                  {profile.label}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="login-password">
            Senha
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {message && <p className="form-error" role="alert">{message}</p>}
          <button className="primary-button access-submit" type="submit" disabled={isSubmitting}>
            <KeyRound size={17} aria-hidden="true" />
            <span>{isSubmitting ? 'Verificando...' : 'Entrar'}</span>
          </button>
        </form>
      </section>
    </main>
  )
}
