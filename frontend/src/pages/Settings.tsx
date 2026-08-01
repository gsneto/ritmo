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
  MoreVertical,
  Share2,
  ShieldCheck,
  Smartphone,
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
  onDataReset?: () => void
  onChangeAccessCode: () => void
}

export default function Settings({
  user,
  users,
  onUserChange,
  onDataReset,
  onChangeAccessCode,
}: SettingsProps) {
  const {
    permission,
    requestPermission,
    sendNotification,
    isSupported,
    isSecureContext,
  } = useNotifications()
  const {
    canInstall,
    install,
    isInstalled,
    isIos,
    isAndroid,
  } = usePwaInstall()
  const push = usePushNotifications(user.id)
  const [isResetting, setIsResetting] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [installMessage, setInstallMessage] = useState('')
  const [isBackupBusy, setIsBackupBusy] = useState(false)
  const [backupMessage, setBackupMessage] = useState('')
  const [notificationMessage, setNotificationMessage] = useState('')
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
    setNotificationMessage('')
    if (!isSecureContext) {
      setNotificationMessage('Abra o Ritmo pelo endereço HTTPS para ativar notificações.')
      return
    }
    if (isIos && !isInstalled) {
      setNotificationMessage('No iPhone, instale o Ritmo na Tela de Início antes de ativar.')
      return
    }
    const granted = await requestPermission()
    if (granted && push.isConfigured) {
      const subscribed = await push.subscribe()
      setNotificationMessage(subscribed
        ? 'Lembretes em segundo plano conectados a este perfil neste aparelho.'
        : 'A permissão foi liberada, mas o segundo plano não conectou.')
      return
    }
    setNotificationMessage(granted
      ? 'Alertas com o app aberto foram ativados.'
      : 'A permissão não foi liberada. Confira os ajustes do aparelho.')
  }

  async function handleNotificationTest() {
    setNotificationMessage('')
    if (push.isSubscribed) {
      const sent = await push.sendTest()
      setNotificationMessage(sent
        ? 'Envio de teste aceito pelo serviço; confira a bandeja de notificações.'
        : 'O envio de teste não foi aceito pelo serviço de notificações.')
      return
    }

    const result = await sendNotification({
      title: 'Teste do Ritmo 🔔',
      body: 'As notificações deste aparelho estão funcionando.',
    })
    setNotificationMessage(result
      ? 'Aviso local enviado. Se não apareceu, confira os ajustes do aparelho.'
      : 'O aparelho não conseguiu mostrar o aviso local.')
  }

  async function handleInstall() {
    setIsInstalling(true)
    setInstallMessage('')
    try {
      const accepted = await install()
      setInstallMessage(
        accepted
          ? 'Instalação iniciada. O Ritmo ficará na tela inicial.'
          : 'Instalação não concluída. Use o menu do navegador para tentar novamente.',
      )
    } catch (error) {
      console.error('Failed to install Ritmo:', error)
      setInstallMessage(
        'Não foi possível abrir a instalação. Use o menu do navegador.',
      )
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
                  : isAndroid
                    ? canInstall
                      ? 'Toque em Instalar para colocar o Ritmo na tela inicial e abrir em tela cheia.'
                      : 'Abra no Chrome e use o menu para colocar o Ritmo na tela inicial.'
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
          {isAndroid && !isInstalled && !canInstall && (
            <span className="settings-android-hint">
              <MoreVertical size={17} aria-hidden="true" />
              Chrome: menu ⋮ → Instalar app ou Adicionar à tela inicial
            </span>
          )}
          {installMessage && (
            <span className="settings-install-status" role="status">
              {installMessage}
            </span>
          )}
        </div>
      </section>

      <section className="panel settings-panel">
        <div className="panel-head">
          <div><p className="section-label">Notificações</p><h2>Alertas</h2></div>
        </div>
        <div className="settings-notification-card">
          {!isSecureContext ? (
            <>
              <BellOff size={20} style={{ color: 'var(--red)' }} />
              <div>
                <strong>Abra pelo endereço seguro</strong>
                <span>Notificações não funcionam pelo IP iniciado com http://. Use o Ritmo instalado pelo endereço HTTPS.</span>
              </div>
            </>
          ) : isIos && !isInstalled ? (
            <>
              <Smartphone size={20} style={{ color: 'var(--accent)' }} />
              <div>
                <strong>Instale o Ritmo primeiro</strong>
                <span>No iPhone: Compartilhar → Adicionar à Tela de Início. Depois abra o app instalado e volte aqui.</span>
              </div>
            </>
          ) : !isSupported ? (
            <>
              <BellOff size={20} style={{ color: 'var(--red)' }} />
              <div>
                <strong>Notificações indisponíveis</strong>
                <span>Este navegador não oferece notificações para o Ritmo. Tente Safari no iPhone ou Chrome no Android.</span>
              </div>
            </>
          ) : push.isSubscribed ? (
            <>
              <Bell size={20} style={{ color: 'var(--green)' }} />
              <div>
                <strong>Lembretes em segundo plano ativados</strong>
                <span>Hábitos, tarefas e compras podem avisar mesmo com o Ritmo fechado.</span>
              </div>
              <div className="settings-notification-actions">
                <button
                  className="ghost-button"
                  type="button"
                  disabled={push.isLoading}
                  onClick={() => void handleNotificationTest()}
                >
                  Testar agora
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={push.isLoading}
                  onClick={() => void push.unsubscribe()}
                >
                  Desativar
                </button>
              </div>
            </>
          ) : permission === 'granted' ? (
            <>
              <Bell size={20} style={{ color: 'var(--green)' }} />
              <div>
                <strong>Alertas com o app aberto</strong>
                <span>
                  {push.isConfigured
                    ? push.isLinkedToOtherProfile
                      ? 'Este aparelho está vinculado a outro perfil. Ative aqui para transferir os lembretes para este perfil.'
                      : 'Conecte o segundo plano para receber lembretes com o Ritmo fechado.'
                    : 'O servidor ainda não está conectado aos avisos em segundo plano.'}
                </span>
              </div>
              <div className="settings-notification-actions">
                <button
                  className="ghost-button"
                  type="button"
                  disabled={push.isLoading}
                  onClick={() => void handleNotificationTest()}
                >
                  Testar agora
                </button>
                {push.isConfigured && push.supported && (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={push.isLoading}
                    onClick={() => void push.subscribe()}
                  >
                    {push.isLinkedToOtherProfile
                      ? 'Ativar neste perfil'
                      : 'Ativar segundo plano'}
                  </button>
                )}
              </div>
            </>
          ) : permission === 'denied' ? (
            <>
              <BellOff size={20} style={{ color: 'var(--red)' }} />
              <div>
                <strong>Notificações bloqueadas</strong>
                <span>Libere o Ritmo em Ajustes → Notificações no celular e abra o app novamente.</span>
              </div>
            </>
          ) : (
            <>
              <Bell size={20} style={{ color: 'var(--muted)' }} />
              <div>
                <strong>Receba seus lembretes</strong>
                <span>
                  {push.isLinkedToOtherProfile
                    ? 'Este aparelho está vinculado a outro perfil. Ative neste perfil para transferir os lembretes.'
                    : 'Ative avisos de hábitos, tarefas, compras e conclusão do Pomodoro.'}
                </span>
              </div>
              <button
                className="primary-button"
                onClick={() => void handleNotificationPermission()}
                disabled={push.isLoading}
                type="button"
              >
                {push.isLinkedToOtherProfile ? 'Ativar neste perfil' : 'Ativar'}
              </button>
            </>
          )}
        </div>
        {push.error && <p className="settings-notification-error" role="alert">{push.error}</p>}
        {notificationMessage && (
          <p className="settings-notification-hint" role="status">{notificationMessage}</p>
        )}
      </section>

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
