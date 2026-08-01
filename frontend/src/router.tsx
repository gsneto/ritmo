import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import type {
  AnchorHTMLAttributes,
  MouseEvent,
  ReactNode,
} from 'react'

interface NavigateOptions {
  replace?: boolean
}

interface RouterLocation {
  pathname: string
  search: string
}

interface RouterContextValue extends RouterLocation {
  navigate: (to: string, options?: NavigateOptions) => void
}

interface RouterProviderProps {
  children: ReactNode
}

interface AppLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className'> {
  to: string
  className?: string | ((isActive: boolean) => string)
}

const RouterContext = createContext<RouterContextValue | null>(null)

function readLocation(): RouterLocation {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
  }
}

export function RouterProvider({ children }: RouterProviderProps) {
  const [location, setLocation] = useState<RouterLocation>(readLocation)

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [location.pathname])

  useEffect(() => {
    function handlePopState() {
      setLocation(readLocation())
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useCallback((to: string, options: NavigateOptions = {}) => {
    const method = options.replace ? 'replaceState' : 'pushState'
    window.history[method]({}, '', to)
    setLocation(readLocation())
  }, [])

  const value = useMemo(
    () => ({ ...location, navigate }),
    [location, navigate],
  )

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useAppRouter(): RouterContextValue {
  const context = useContext(RouterContext)
  if (!context) {
    throw new Error('useAppRouter must be used inside RouterProvider')
  }
  return context
}

export function useAppSearchParams() {
  const { pathname, search, navigate } = useAppRouter()
  const searchParams = useMemo(() => new URLSearchParams(search), [search])

  const setSearchParams = useCallback((
    next: Record<string, string>,
    options: NavigateOptions = {},
  ) => {
    const query = new URLSearchParams(next).toString()
    navigate(`${pathname}${query ? `?${query}` : ''}`, options)
  }, [navigate, pathname])

  return [searchParams, setSearchParams] as const
}

export function AppLink({
  to,
  className,
  children,
  onClick,
  ...props
}: AppLinkProps) {
  const { pathname, navigate } = useAppRouter()
  const targetPath = to.split(/[?#]/, 1)[0] || '/'
  const isActive = pathname === targetPath
  const resolvedClassName = typeof className === 'function'
    ? className(isActive)
    : className

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return
    }

    event.preventDefault()
    navigate(to)
  }

  return (
    <a
      {...props}
      href={to}
      className={resolvedClassName}
      aria-current={isActive ? 'page' : undefined}
      onClick={handleClick}
    >
      {children}
    </a>
  )
}
