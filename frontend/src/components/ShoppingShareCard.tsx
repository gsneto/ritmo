import { useEffect, useState } from 'react'
import { KeyRound, Link2, RefreshCw, Unlink, UsersRound } from 'lucide-react'
import { apiRoutes } from '../services/api'
import type { ShoppingShareStatus } from '../services/api'

interface ShoppingShareCardProps {
  userId: number
  onShareChanged: () => void
}

function displayCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

export default function ShoppingShareCard({
  userId,
  onShareChanged,
}: ShoppingShareCardProps) {
  const [share, setShare] = useState<ShoppingShareStatus | null>(null)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void apiRoutes.getShoppingShare(userId)
      .then(response => {
        if (active) setShare(response.data)
      })
      .catch(loadError => {
        console.error('Failed to load shopping share:', loadError)
        if (active) setError('Não foi possível carregar o compartilhamento.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [userId])

  async function createInvite() {
    setBusy(true)
    setError('')
    try {
      const response = await apiRoutes.createShoppingShareInvite(userId)
      setShare(response.data)
    } catch (inviteError) {
      console.error('Failed to create shopping invite:', inviteError)
      setError('Não foi possível gerar o código agora.')
    } finally {
      setBusy(false)
    }
  }

  async function redeemInvite() {
    const normalizedCode = code.trim().toUpperCase()
    if (!normalizedCode) return
    setBusy(true)
    setError('')
    try {
      const response = await apiRoutes.redeemShoppingShareInvite(
        userId,
        normalizedCode,
      )
      setShare(response.data)
      setCode('')
      onShareChanged()
    } catch (redeemError) {
      console.error('Failed to redeem shopping invite:', redeemError)
      setError('Código inválido, expirado ou já utilizado.')
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (share?.paired && !window.confirm(
      'Desconectar as compras compartilhadas? Nenhuma lista será apagada.',
    )) return
    setBusy(true)
    setError('')
    try {
      const response = await apiRoutes.deleteShoppingShare(userId)
      setShare(response.data)
      onShareChanged()
    } catch (disconnectError) {
      console.error('Failed to disconnect shopping share:', disconnectError)
      setError('Não foi possível desconectar agora.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel shopping-share-card" aria-labelledby="shopping-share-title">
      <span className="shopping-share-icon" aria-hidden="true">
        <UsersRound size={22} />
      </span>
      <div className="shopping-share-copy">
        <p className="section-label">Entre perfis</p>
        <h2 id="shopping-share-title">
          {share?.paired && share.partner
            ? `Compras com ${share.partner.name}`
            : 'Compartilhar compras'}
        </h2>
        <p>
          {share?.paired
            ? 'As compras aparecem juntas nos dois perfis. Os demais dados continuam organizados separadamente.'
            : 'Conecte os perfis para mostrar listas, itens e histórico no mesmo espaço de compras.'}
        </p>
      </div>

      {loading ? (
        <span className="shopping-share-loading" role="status">
          <RefreshCw size={17} aria-hidden="true" /> Carregando...
        </span>
      ) : share?.paired ? (
        <button
          className="ghost-button compact-button shopping-share-disconnect"
          type="button"
          onClick={() => void disconnect()}
          disabled={busy}
        >
          <Unlink size={17} aria-hidden="true" />
          Desconectar
        </button>
      ) : share?.invite_code ? (
        <div className="shopping-invite-ready">
          <span>Envie este código ao outro perfil</span>
          <strong aria-label={`Código ${share.invite_code}`}>
            {displayCode(share.invite_code)}
          </strong>
          <button
            className="ghost-button compact-button"
            type="button"
            onClick={() => void disconnect()}
            disabled={busy}
          >
            Cancelar convite
          </button>
        </div>
      ) : (
        <div className="shopping-share-actions">
          <button
            className="ghost-button compact-button"
            type="button"
            onClick={() => void createInvite()}
            disabled={busy}
          >
            <KeyRound size={17} aria-hidden="true" />
            Gerar código
          </button>
          <form
            className="shopping-share-redeem"
            onSubmit={event => {
              event.preventDefault()
              void redeemInvite()
            }}
          >
            <label htmlFor="shopping-share-code">Código recebido</label>
            <div>
              <input
                id="shopping-share-code"
                value={code}
                onChange={event => setCode(event.target.value)}
                placeholder="ABCD-EFGH"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={9}
                disabled={busy}
              />
              <button
                className="primary-button"
                type="submit"
                disabled={busy || code.trim().length < 8}
              >
                <Link2 size={17} aria-hidden="true" />
                Conectar
              </button>
            </div>
          </form>
        </div>
      )}

      {error && <p className="shopping-share-error" role="alert">{error}</p>}
    </section>
  )
}
