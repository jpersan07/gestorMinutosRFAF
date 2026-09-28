import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { Boot } from './app/Boot'
import { router } from './router'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot>
      <RouterProvider router={router} />
    </Boot>
  </StrictMode>,
)
