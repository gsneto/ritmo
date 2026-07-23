import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { api, apiRoutes } from './services/api'
import Today from './pages/Today'
import Habits from './pages/Habits'
import Tasks from './pages/Tasks'
import Focus from './pages/Focus'
import Progress from './pages/Progress'
import Settings from './pages/Settings'
import Topbar from './components/Topbar'
import Navigation from './components/Navigation'

export interface User {
  id: number
  profile_id: string
  name: string
  initials: string
  theme: 'light' | 'dark'
}

export default function App() {
  const navigate = useNavigate()
  const [users, setUsers] = useState<User[]>([])
  const [activeUser, setActiveUser] = useState<User | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    loadUsers()
  }, [])

  useEffect(() => {
    if (users.length > 0 && !activeUser) {
      const saved = localStorage.getItem('ritmo-active-profile')
      const found = users.find(u => u.profile_id === saved)
      setActiveUser(found || users[0])
    }
  }, [users, activeUser])

  useEffect(() => {
    if (activeUser) {
      document.documentElement.dataset.theme = activeUser.theme
      localStorage.setItem('ritmo-active-profile', activeUser.profile_id)
    }
  }, [activeUser])

  async function loadUsers() {
    try {
      const response = await apiRoutes.getUsers()
      setUsers(response.data)
    } catch (error) {
      console.error('Failed to load users:', error)
    }
  }

  function handleSettingsClick() {
    navigate('/settings')
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
  }

  if (users.length === 0) {
    return <div className="loading">Carregando...</div>
  }

  return (
    <div className="app-shell">
      <Topbar user={activeUser!} onSettingsClick={handleSettingsClick} />
      <Navigation />
      <main key={refreshKey}>
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<Today userId={activeUser!.id} />} />
          <Route path="/habits" element={<Habits userId={activeUser!.id} />} />
          <Route path="/tasks" element={<Tasks userId={activeUser!.id} />} />
          <Route path="/focus" element={<Focus userId={activeUser!.id} />} />
          <Route path="/progress" element={<Progress userId={activeUser!.id} />} />
          <Route path="/settings" element={<Settings user={activeUser!} users={users} onUserChange={setActiveUser} onThemeChange={changeTheme} onDataReset={handleDataReset} />} />
        </Routes>
      </main>
    </div>
  )
}
