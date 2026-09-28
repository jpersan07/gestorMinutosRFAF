import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import './index.css'

// Registro del service worker (app disponible sin conexión). En modo 'prompt' una versión
// nueva espera; el aviso para actualizar se añadirá en la Fase 2, fuera de partidos en juego.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
