import { NavLink } from 'react-router-dom'
import { CalendarCheck, Repeat, ListTodo, Timer, ChartNoAxesColumn, Settings } from 'lucide-react'

export default function Navigation() {
  const navItems = [
    { to: '/today', icon: CalendarCheck, label: 'Hoje' },
    { to: '/habits', icon: Repeat, label: 'Hábitos' },
    { to: '/tasks', icon: ListTodo, label: 'Tarefas' },
    { to: '/focus', icon: Timer, label: 'Foco' },
    { to: '/progress', icon: ChartNoAxesColumn, label: 'Evolução' },
    { to: '/settings', icon: Settings, label: 'Ajustes' },
  ]

  return (
    <nav className="view-nav" aria-label="Navegação principal">
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => isActive ? 'active' : ''}
        >
          <Icon size={18} strokeWidth={2.2} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
