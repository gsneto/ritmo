import React from 'react'
import ReactDOM from 'react-dom/client'
import AppWrapper from './AppWrapper'
import './styles/index.css'
import './styles/identity.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppWrapper />
  </React.StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(error => {
      console.error('Não foi possível ativar o modo instalável do Ritmo:', error)
    })
  })
}
