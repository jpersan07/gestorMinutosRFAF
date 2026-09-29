import { Outlet } from 'react-router'
import { OfflineBanner } from '../sync/ConnectionNotice'
import { SessionLostBanner } from './SessionLostBanner'
import { UpdatePrompt } from './UpdatePrompt'

export function RootLayout() {
  return (
    <>
      <SessionLostBanner />
      <OfflineBanner />
      <Outlet />
      <UpdatePrompt />
    </>
  )
}
