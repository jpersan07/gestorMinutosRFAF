import { createBrowserRouter, Navigate } from 'react-router'
import { ErrorScreen } from './app/routing/ErrorScreen'
import { RequireAccount } from './app/routing/RequireAccount'
import { RootLayout } from './app/routing/RootLayout'
import { Start } from './app/routing/Start'
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage'
import { LoginPage } from './features/auth/LoginPage'
import { ResetPasswordPage } from './features/auth/ResetPasswordPage'
import { TeamSetupPage } from './features/auth/TeamSetupPage'
import { MatchesPage } from './features/matches/MatchesPage'
import { EditMatchPage } from './features/matches/EditMatchPage'
import { MatchHubPage } from './features/matches/MatchHubPage'
import { NewMatchPage } from './features/matches/NewMatchPage'
import { MatchScreen } from './features/match/MatchScreen'
import { SummaryPage } from './features/summary/SummaryPage'
import { SquadPage } from './features/squad/SquadPage'
import { PlayerFormPage } from './features/players/PlayerFormPage'
import { PlayersPage } from './features/players/PlayersPage'

export const router = createBrowserRouter([
  {
    Component: RootLayout,
    errorElement: <ErrorScreen />,
    children: [
      { index: true, Component: Start },
      { path: 'login', Component: LoginPage },
      { path: 'recuperar', Component: ForgotPasswordPage },
      { path: 'restablecer', Component: ResetPasswordPage },
      { path: 'entrar', Component: TeamSetupPage },
      {
        Component: RequireAccount,
        children: [
          { path: 'partidos', Component: MatchesPage },
          { path: 'partidos/nuevo', Component: NewMatchPage },
          { path: 'partidos/:matchId', Component: MatchHubPage },
          { path: 'partidos/:matchId/editar', Component: EditMatchPage },
          { path: 'partidos/:matchId/convocatoria', Component: SquadPage },
          { path: 'partidos/:matchId/juego', Component: MatchScreen },
          { path: 'partidos/:matchId/resumen', Component: SummaryPage },
          { path: 'jugadores', Component: PlayersPage },
          { path: 'jugadores/nuevo', Component: PlayerFormPage },
          { path: 'jugadores/:playerId', Component: PlayerFormPage },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
