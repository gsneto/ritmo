import { CalendarCheck, ListTodo, Repeat, ShoppingBasket, Sparkles } from 'lucide-react'
import { AppLink } from '../router'

export default function Navigation() {
  const navItems = [
    { to: '/today', icon: CalendarCheck, label: 'Hoje' },
    { to: '/habits', icon: Repeat, label: 'Hábitos' },
    { to: '/tasks', icon: ListTodo, label: 'Tarefas' },
    { to: '/shopping', icon: ShoppingBasket, label: 'Compras' },
    { to: '/anahi', icon: Sparkles, label: 'ANAHÍ' },
  ]

  return (
    <nav className="view-nav" aria-label="Navegação principal">
      {navItems.map(({ to, icon: Icon, label }) => (
        <AppLink
          key={to}
          to={to}
          className={isActive => isActive ? 'active' : ''}
        >
          <Icon size={18} strokeWidth={2.2} aria-hidden="true" />
          <span>{label}</span>
        </AppLink>
      ))}
    </nav>
  )
}
