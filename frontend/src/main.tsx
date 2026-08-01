import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import AppWrapper from './AppWrapper'
import ErrorBoundary from './components/ErrorBoundary'
import './styles/index.css'
import './styles/identity.css'

const sentryDsn = import.meta.env.VITE_SENTRY_DSN?.trim()

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    sendDefaultPii: false,
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppWrapper />
    </ErrorBoundary>
  </React.StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(error => {
      console.error('Não foi possível ativar o modo instalável do Ritmo:', error)
    })
  })
}
