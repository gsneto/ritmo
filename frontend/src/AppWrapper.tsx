import App from './App'
import { RouterProvider } from './router'

export default function AppWrapper() {
  return (
    <RouterProvider>
      <App />
    </RouterProvider>
  )
}
