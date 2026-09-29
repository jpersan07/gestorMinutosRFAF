import { Outlet } from 'react-router'
import { SessionLostBanner } from './SessionLostBanner'
import { UpdatePrompt } from './UpdatePrompt'

export function RootLayout() {
  return (
    <>
      <SessionLostBanner />
      <Outlet />
      <UpdatePrompt />
    </>
  )
}
