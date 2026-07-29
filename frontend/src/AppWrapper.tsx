import App from './App'
import { PwaInstallProvider } from './hooks/usePwaInstall'
import { RouterProvider } from './router'

export default function AppWrapper() {
  return (
    <PwaInstallProvider>
      <RouterProvider>
        <App />
      </RouterProvider>
    </PwaInstallProvider>
  )
}
