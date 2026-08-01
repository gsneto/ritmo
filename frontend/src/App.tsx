import { useCallback, useState, useEffect } from 'react'
import {
  apiRoutes,
  clearAccessKey,
  isUnauthorizedError,
  setAccessKey,
  UNAUTHORIZED_EVENT,
} from './services/api'
import type { User } from './services/api'
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
import AccessCodeGate from './components/AccessCodeGate'
import { useAppRouter } from './router'
import { useDailyReminders } from './hooks/useDailyReminders'
import { resolvePwaShortcut } from './utils/pwaShortcuts'

type AppStatus = 'loading' | 'ready' | 'error' | 'access'
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
  const [accessMessage, setAccessMessage] = useState('')
  useDailyReminders(activeUser?.id ?? null)

  const loadUsers = useCallback(async (isAccessRetry = false) => {
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

      const saved = localStorage.getItem('ritmo-active-profile')
      const found = response.data.find(user => user.profile_id === saved)
      setUsers(response.data)
      setActiveUser(found || response.data[0])
      setAccessMessage('')
      setStatus('ready')
    } catch (error) {
      if (isUnauthorizedError(error)) {
        setUsers([])
        setActiveUser(null)
        setAccessMessage(isAccessRetry ? 'Código recusado. Confira e tente novamente.' : '')
        setStatus('access')
        return
      }

      console.error('Failed to load users:', error)
      setErrorMessage('Não foi possível conectar ao Ritmo. Confira se a API está disponível.')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  useEffect(() => {
    function handleUnauthorized() {
      setAccessMessage('Seu código de acesso precisa ser informado novamente.')
      setStatus('access')
    }

    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized)
  }, [])

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

  async function handleAccessSubmit(code: string) {
    setAccessKey(code)
    setAccessMessage('')
    await loadUsers(true)
  }

  function handleChangeAccessCode() {
    clearAccessKey()
    setUsers([])
    setActiveUser(null)
    setAccessMessage('Digite o novo código pessoal para continuar.')
    setStatus('access')
  }

  function handleRetry() {
    void loadUsers()
  }

  function handleUserChange(user: User) {
    setActiveUser(user)
    if (status !== 'ready') {
      setStatus('ready')
    }
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

  if (status === 'access') {
    return <AccessCodeGate message={accessMessage} onSubmit={handleAccessSubmit} />
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
      <main key={refreshKey}>
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
