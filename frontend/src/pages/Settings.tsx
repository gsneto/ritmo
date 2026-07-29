import {
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import type { RitmoBackup, User } from '../services/api'
import {
  Bell,
  BellOff,
  Download,
  FileJson,
  KeyRound,
  Moon,
  Share2,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react'
import { useNotifications } from '../hooks/useNotifications'
import { usePwaInstall } from '../hooks/usePwaInstall'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { apiRoutes } from '../services/api'

interface SettingsProps {
  user: User
  users: User[]
  onUserChange: (user: User) => void
  onThemeChange: (theme: 'light' | 'dark') => void
  onDataReset?: () => void
  onChangeAccessCode: () => void
}

export default function Settings({
  user,
  users,
  onUserChange,
  onThemeChange,
  onDataReset,
  onChangeAccessCode,
}: SettingsProps) {
  const { permission, requestPermission, isSupported } = useNotifications()
  const { canInstall, install, isInstalled, isIos } = usePwaInstall()
  const push = usePushNotifications(user.id)
  const [isResetting, setIsResetting] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [isBackupBusy, setIsBackupBusy] = useState(false)
  const [backupMessage, setBackupMessage] = useState('')
  const backupInputRef = useRef<HTMLInputElement>(null)

  async function handleReset() {
    if (!confirm(`Limpar TODOS os dados de ${user.name}?\n\nIsso remove:\n- Todos os hábitos\n- Todas as tarefas\n- O plano e o histórico de treinos\n- O livro e suas anotações\n- Todas as listas de compras\n- Todo o histórico de gastos\n\nEsta ação não pode ser desfeita.`)) return

    setIsResetting(true)
    try {
      await apiRoutes.resetUserData(user.id)
      setIsResetting(false)
      alert('Dados limpos com sucesso!')
      if (onDataReset) onDataReset()
    } catch (error) {
      console.error('Failed to reset data:', error)
      alert('Erro ao limpar dados. Tente novamente.')
      setIsResetting(false)
    }
  }

  async function handleNotificationPermission() {
    const granted = await requestPermission()
    if (granted && push.isConfigured) {
      await push.subscribe()
    }
  }

  async function handleInstall() {
    setIsInstalling(true)
    try {
      await install()
    } finally {
      setIsInstalling(false)
    }
  }

  async function handleBackupDownload() {
    setIsBackupBusy(true)
    setBackupMessage('')
    try {
      const response = await apiRoutes.getUserBackup(user.id)
      const blob = new Blob(
        [JSON.stringify(response.data, null, 2)],
        { type: 'application/json;charset=utf-8' },
      )
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `ritmo-${user.profile_id}-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
      setBackupMessage('Backup baixado. Guarde esse arquivo em um lugar seguro.')
    } catch (error) {
      console.error('Failed to export backup:', error)
      setBackupMessage('Não foi possível criar o backup. Tente novamente.')
    } finally {
      setIsBackupBusy(false)
    }
  }

  async function handleBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (file.size > 20 * 1024 * 1024) {
      setBackupMessage('O arquivo é maior que 20 MB e não pode ser restaurado.')
      return
    }

    setIsBackupBusy(true)
    setBackupMessage('')
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (
        typeof parsed !== 'object'
        || parsed === null
        || !('version' in parsed)
        || parsed.version !== 1
        || !('app' in parsed)
        || parsed.app !== 'Ritmo'
      ) {
        throw new Error('Invalid Ritmo backup')
      }
      const backup = parsed as RitmoBackup
      const confirmed = confirm(
        `Restaurar o backup em ${user.name}?\n\n`
        + 'Os dados atuais deste perfil serão substituídos. '
        + 'A restauração só é concluída se o arquivo inteiro for válido.',
      )
      if (!confirmed) {
        setIsBackupBusy(false)
        return
      }

      const response = await apiRoutes.restoreUserBackup(user.id, backup)
      const restoredTotal = Object.values(response.data.restored)
        .reduce((total, value) => total + value, 0)
      setBackupMessage(`Backup restaurado com segurança: ${restoredTotal} registros principais.`)
      onDataReset?.()
    } catch (error) {
      console.error('Failed to restore backup:', error)
      setBackupMessage('Arquivo inválido ou incompatível. Seus dados atuais foram preservados.')
    } finally {
      setIsBackupBusy(false)
    }
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
        <div className="theme-switch" role="group" aria-label="Escolher tema">
          <button
            type="button"
            className={user.theme === 'light' ? 'active' : ''}
            onClick={() => onThemeChange('light')}
            aria-pressed={user.theme === 'light'}
          >
            <Sun size={18} aria-hidden="true" />
            <span>Claro</span>
          </button>
          <button
            type="button"
            className={user.theme === 'dark' ? 'active' : ''}
            onClick={() => onThemeChange('dark')}
            aria-pressed={user.theme === 'dark'}
          >
            <Moon size={18} aria-hidden="true" />
            <span>Escuro</span>
          </button>
        </div>
      </section>

      <section className="panel settings-panel">
        <div className="panel-head">
          <div><p className="section-label">No celular</p><h2>Instalar o Ritmo</h2></div>
        </div>
        <div className="settings-install-card">
          <span className="settings-install-icon" aria-hidden="true">
            <Smartphone size={22} />
          </span>
          <div>
            <strong>
              {isInstalled ? 'Ritmo instalado' : 'Use como um aplicativo'}
            </strong>
            <p>
              {isInstalled
                ? 'O Ritmo já abre em tela cheia pela sua tela inicial.'
                : isIos
                  ? 'No Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.'
                  : 'Instale para abrir em tela cheia e acessar mais rápido.'}
            </p>
          </div>
          {canInstall && !isInstalled && (
            <button
              className="primary-button settings-install-action"
              type="button"
              onClick={() => void handleInstall()}
              disabled={isInstalling}
            >
              <Download size={17} aria-hidden="true" />
              {isInstalling ? 'Instalando...' : 'Instalar'}
            </button>
          )}
          {isIos && !isInstalled && (
            <span className="settings-ios-hint">
              <Share2 size={16} aria-hidden="true" />
              Compartilhar → Adicionar à Tela de Início
            </span>
          )}
        </div>
      </section>

      {isSupported && (
        <section className="panel settings-panel">
          <div className="panel-head">
            <div><p className="section-label">Notificações</p><h2>Alertas</h2></div>
          </div>
          <div className="settings-notification-card">
            {push.isSubscribed ? (
              <>
                <Bell size={20} style={{ color: 'var(--green)' }} />
                <div>
                  <strong>Lembretes em segundo plano ativados</strong>
                  <span>O aparelho pode avisar sobre hábitos, tarefas e compras mesmo com o Ritmo fechado.</span>
                </div>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={push.isLoading}
                  onClick={() => void push.unsubscribe()}
                >
                  Desativar
                </button>
              </>
            ) : permission === 'granted' ? (
              <>
                <Bell size={20} style={{ color: 'var(--green)' }} />
                <div>
                  <strong>Alertas locais ativados</strong>
                  <span>
                    {push.isConfigured
                      ? 'Ative o segundo plano para receber lembretes com o app fechado.'
                      : 'Check-ins e Pomodoro avisam enquanto o app está em uso.'}
                  </span>
                </div>
                {push.isConfigured && push.supported && (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={push.isLoading}
                    onClick={() => void push.subscribe()}
                  >
                    Ativar segundo plano
                  </button>
                )}
              </>
            ) : permission === 'denied' ? (
              <>
                <BellOff size={20} style={{ color: 'var(--red)' }} />
                <div>
                  <strong>Notificações bloqueadas</strong>
                  <span>Libere o Ritmo nos ajustes do navegador ou do iPhone.</span>
                </div>
              </>
            ) : (
              <>
                <Bell size={20} style={{ color: 'var(--muted)' }} />
                <div>
                  <strong>Receba seus lembretes</strong>
                  <span>Ative avisos de hábitos, tarefas, compras e conclusão do Pomodoro.</span>
                </div>
                <button
                  className="primary-button"
                  onClick={() => void handleNotificationPermission()}
                  disabled={push.isLoading}
                  type="button"
                >
                  Ativar
                </button>
              </>
            )}
          </div>
          {push.error && <p className="settings-notification-error" role="alert">{push.error}</p>}
          {isIos && !isInstalled && (
            <p className="settings-notification-hint">
              No iPhone, instale o Ritmo na Tela de Início antes de ativar avisos em segundo plano.
            </p>
          )}
        </section>
      )}

      <section className="panel settings-panel">
        <div className="panel-head">
          <div><p className="section-label">Segurança</p><h2>Código pessoal</h2></div>
        </div>
        <p className="settings-copy">Troque o código usado para acessar seus dados neste navegador.</p>
        <button className="ghost-button settings-action" type="button" onClick={onChangeAccessCode}>
          <KeyRound size={17} aria-hidden="true" />
          <span>Trocar código de acesso</span>
        </button>
      </section>

      <section className="panel settings-panel">
        <div className="panel-head">
          <div><p className="section-label">Proteção dos dados</p><h2>Backup e restauração</h2></div>
        </div>
        <div className="settings-backup-card">
          <span className="settings-backup-icon" aria-hidden="true">
            <ShieldCheck size={23} />
          </span>
          <div>
            <strong>Leve todo o seu Ritmo com você</strong>
            <p>
              O arquivo inclui hábitos, tarefas, compras, gastos, treinos,
              cargas, livros, sessões e anotações deste perfil.
            </p>
          </div>
        </div>
        <div className="settings-backup-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => void handleBackupDownload()}
            disabled={isBackupBusy}
          >
            <Download size={17} aria-hidden="true" />
            <span>{isBackupBusy ? 'Processando…' : 'Baixar backup JSON'}</span>
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => backupInputRef.current?.click()}
            disabled={isBackupBusy}
          >
            <Upload size={17} aria-hidden="true" />
            <span>Restaurar arquivo</span>
          </button>
          <input
            ref={backupInputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={event => void handleBackupFile(event)}
            aria-label="Escolher backup JSON do Ritmo"
          />
        </div>
        <p className="settings-backup-note">
          <FileJson size={15} aria-hidden="true" />
          O backup fica no seu aparelho. O Ritmo não envia esse arquivo para outro serviço.
        </p>
        {backupMessage && (
          <p className="settings-backup-status" role="status">{backupMessage}</p>
        )}
      </section>

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
          <Trash2 size={17} aria-hidden="true" />
          <span>{isResetting ? 'Limpando...' : 'Limpar dados deste perfil'}</span>
        </button>
      </section>
    </div>
  )
}
