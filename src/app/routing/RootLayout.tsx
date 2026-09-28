import { Outlet } from 'react-router'
import { UpdatePrompt } from './UpdatePrompt'

export function RootLayout() {
  return (
    <>
      <Outlet />
      <UpdatePrompt />
    </>
  )
}
