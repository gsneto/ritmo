import { useCallback, useState, useEffect } from 'react'
import {
  apiRoutes,
  isUnauthorizedError,
  UNAUTHORIZED_EVENT,
} from './services/api'
import type { PublicProfile, User } from './services/api'
import Today from './pages/Today'
import Habits from './pages/Habits'
import Tasks from './pages/Tasks'
import Shopping from './pages/Shopping'
import Reading from './pages/Focus'
import Progress from './pages/Progress'
import Settings from './pages/Settings'
import Workouts from './pages/Workouts'
import Anahi from './pages/Anahi'
import Topbar from './components/Topbar'
import Navigation from './components/Navigation'
import LoginGate from './components/LoginGate'
import { useAppRouter } from './router'
import { useDailyReminders } from './hooks/useDailyReminders'
import { resolvePwaShortcut } from './utils/pwaShortcuts'

type AppStatus = 'loading' | 'ready' | 'error' | 'login'
const VALID_PATHS = new Set([
  '/today',
  '/habits',
  '/tasks',
  '/shopping',
  '/anahi',
  '/reading',
  '/workouts',
  '/progress',
  '/settings',
])

export default function App() {
  const { pathname, search, navigate } = useAppRouter()
  const [users, setUsers] = useState<User[]>([])
  const [activeUser, setActiveUser] = useState<User | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [status, setStatus] = useState<AppStatus>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [loginMessage, setLoginMessage] = useState('')
  const [publicProfiles, setPublicProfiles] = useState<PublicProfile[]>([])
  const [pendingProfileId, setPendingProfileId] = useState('')
  useDailyReminders(activeUser?.id ?? null)

  const loadPublicProfiles = useCallback(async () => {
    try {
      const response = await apiRoutes.getPublicProfiles()
      setPublicProfiles(response.data)
    } catch (error) {
      console.error('Failed to load profiles:', error)
      setPublicProfiles([])
    }
  }, [])

  const showLogin = useCallback(
    async (message = '', profileId = '') => {
      setUsers([])
      setActiveUser(null)
      setLoginMessage(message)
      setPendingProfileId(profileId)
      await loadPublicProfiles()
      setStatus('login')
    },
    [loadPublicProfiles],
  )

  const loadUsers = useCallback(async () => {
    setStatus('loading')
    setErrorMessage('')

    try {
      const response = await apiRoutes.getUsers()
      if (response.data.length === 0) {
        setUsers([])
        setActiveUser(null)
        setErrorMessage('Nenhum perfil pessoal foi encontrado na API.')
        setStatus('error')
        return
      }

      const session = await apiRoutes.getSession()
      const authenticated = response.data.find(
        user => user.profile_id === session.data.profile.profile_id,
      )

      setUsers(response.data)
      setActiveUser(authenticated ?? null)
      setLoginMessage('')
      setStatus(authenticated ? 'ready' : 'login')
      if (!authenticated) {
        await showLogin('Sessão encerrada. Entre novamente.')
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        await showLogin('')
        return
      }

      console.error('Failed to load users:', error)
      setErrorMessage('Não foi possível conectar ao Ritmo. Confira se a API está disponível.')
      setStatus('error')
    }
  }, [showLogin])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  useEffect(() => {
    function handleUnauthorized() {
      void showLogin('Sua sessão expirou. Entre novamente.')
    }

    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized)
  }, [showLogin])

  useEffect(() => {
    if (!activeUser) return

    document.documentElement.dataset.theme = activeUser.theme
    localStorage.setItem('ritmo-active-profile', activeUser.profile_id)
  }, [activeUser])

  useEffect(() => {
    const shortcutDestination = resolvePwaShortcut(search)
    if (shortcutDestination) {
      navigate(shortcutDestination, { replace: true })
      return
    }

    if (pathname === '/focus') {
      navigate(`/reading${search}`, { replace: true })
      return
    }

    if (pathname === '/habits' && new URLSearchParams(search).get('workout') === '1') {
      navigate('/workouts', { replace: true })
      return
    }

    if (!VALID_PATHS.has(pathname)) {
      navigate('/today', { replace: true })
    }
  }, [navigate, pathname, search])

  async function handleLogin(profileId: string, password: string) {
    setLoginMessage('')
    try {
      const response = await apiRoutes.login(profileId, password)
      const profile = response.data.profile
      setActiveUser(profile)
      setPendingProfileId('')
      await loadUsers()
    } catch (error) {
      if (isUnauthorizedError(error)) {
        setLoginMessage('Perfil ou senha inválidos.')
        return
      }
      console.error('Failed to sign in:', error)
      setLoginMessage('Não foi possível entrar agora. Tente novamente.')
    }
  }

  async function handleChangeAccessCode() {
    try {
      await apiRoutes.logout()
    } catch (error) {
      console.error('Failed to sign out:', error)
    }
    await showLogin('Você saiu deste aparelho. Entre novamente.')
  }

  function handleRetry() {
    void loadUsers()
  }

  async function handleUserChange(user: User) {
    if (activeUser && user.id === activeUser.id) {
      return
    }
    try {
      await apiRoutes.logout()
    } catch (error) {
      console.error('Failed to sign out before profile switch:', error)
    }
    // The anonymous login list only exposes opaque handles, so there is no
    // way to preselect the chosen profile. The user picks the label shown in
    // Settings for that profile.
    await showLogin('Entre com a senha deste perfil para continuar.')
  }

  function handleHeaderMenuNavigate(destination: '/workouts' | '/reading' | '/progress' | '/settings') {
    navigate(destination)
  }

  async function changeTheme(theme: 'light' | 'dark') {
    if (!activeUser) return
    try {
      const response = await apiRoutes.updateTheme(activeUser.id, theme)
      const updated = response.data
      setActiveUser(updated)
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u))
    } catch (error) {
      console.error('Failed to change theme:', error)
    }
  }

  function handleDataReset() {
    setRefreshKey(k => k + 1)
    void loadUsers()
  }

  if (status === 'login') {
    return (
      <LoginGate
        profiles={publicProfiles}
        message={loginMessage}
        initialProfileId={pendingProfileId}
        onSubmit={handleLogin}
      />
    )
  }

  if (status === 'loading') {
    return <div className="loading" role="status">Carregando o Ritmo...</div>
  }

  if (status === 'error') {
    return (
      <main className="state-shell">
        <section className="panel state-panel" role="alert">
          <h1>Não foi possível abrir o app</h1>
          <p>{errorMessage}</p>
          <button className="primary-button" type="button" onClick={handleRetry}>
            Tentar novamente
          </button>
        </section>
      </main>
    )
  }

  if (!activeUser) {
    return <div className="loading" role="status">Preparando seu perfil...</div>
  }

  const activePath = VALID_PATHS.has(pathname) ? pathname : '/today'

  return (
    <div className="app-shell">
      <Topbar
        user={activeUser}
        onMenuNavigate={handleHeaderMenuNavigate}
        onThemeChange={changeTheme}
      />
      <div className="identity-band" aria-hidden="true">
        <img src="/grafismo-indigena-ritmo.png" alt="" />
      </div>
      <Navigation />
      <main key={`${activeUser.id}:${refreshKey}`}>
        {activePath === '/today' && <Today userId={activeUser.id} />}
        {activePath === '/habits' && (
          <Habits
            userId={activeUser.id}
            quickCheckInRequested={new URLSearchParams(search).get('quick') === '1'}
          />
        )}
        {activePath === '/tasks' && <Tasks userId={activeUser.id} />}
        {activePath === '/shopping' && (
          <Shopping
            userId={activeUser.id}
            createRequested={new URLSearchParams(search).get('create') === '1'}
            onCreateRequestHandled={() => navigate('/shopping', { replace: true })}
          />
        )}
        {activePath === '/anahi' && <Anahi userId={activeUser.id} />}
        {activePath === '/reading' && <Reading userId={activeUser.id} />}
        {activePath === '/workouts' && <Workouts userId={activeUser.id} />}
        {activePath === '/progress' && <Progress userId={activeUser.id} />}
        {activePath === '/settings' && (
          <Settings
            user={activeUser}
            users={users}
            onUserChange={handleUserChange}
            onDataReset={handleDataReset}
            onChangeAccessCode={handleChangeAccessCode}
          />
        )}
      </main>
    </div>
  )
}
