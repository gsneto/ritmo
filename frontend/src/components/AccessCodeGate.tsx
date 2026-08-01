import { useState } from 'react'
import type { FormEvent } from 'react'
import { Activity, KeyRound } from 'lucide-react'

interface AccessCodeGateProps {
  message?: string
  onSubmit: (code: string) => Promise<void>
}

export default function AccessCodeGate({ message, onSubmit }: AccessCodeGateProps) {
  const [code, setCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedCode = code.trim()
    if (!trimmedCode || isSubmitting) return

    setIsSubmitting(true)
    try {
      await onSubmit(trimmedCode)
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
          <p className="section-label">Ritmo pessoal</p>
          <h1 id="access-title">Digite seu código de acesso</h1>
          <p>Este código protege os dados do seu app. Não é necessário criar uma conta.</p>
        </div>
        <form className="entry-form" onSubmit={handleSubmit}>
          <label htmlFor="personal-access-code">
            Código pessoal
            <input
              id="personal-access-code"
              type="password"
              value={code}
              onChange={event => setCode(event.target.value)}
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
