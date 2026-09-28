import { createBrowserRouter, Navigate } from 'react-router'
import { ErrorScreen } from './app/routing/ErrorScreen'
import { RequireCoach } from './app/routing/RequireCoach'
import { RootLayout } from './app/routing/RootLayout'
import { Start } from './app/routing/Start'
import { CoachSelectPage } from './features/coach/CoachSelectPage'
import { MatchesPage } from './features/matches/MatchesPage'
import { PlayerFormPage } from './features/players/PlayerFormPage'
import { PlayersPage } from './features/players/PlayersPage'

export const router = createBrowserRouter([
  {
    Component: RootLayout,
    errorElement: <ErrorScreen />,
    children: [
      { index: true, Component: Start },
      { path: 'quien', Component: CoachSelectPage },
      {
        Component: RequireCoach,
        children: [
          { path: 'partidos', Component: MatchesPage },
          { path: 'jugadores', Component: PlayersPage },
          { path: 'jugadores/nuevo', Component: PlayerFormPage },
          { path: 'jugadores/:playerId', Component: PlayerFormPage },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
