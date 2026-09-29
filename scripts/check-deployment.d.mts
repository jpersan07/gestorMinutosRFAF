// Tipos de scripts/check-deployment.mjs (para usarlo desde los tests E2E en TypeScript).
export interface DeploymentCheck {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

export function checkDeployment(
  baseUrl: string,
  options?: { readonly requireHeaders?: boolean; readonly expectSupabase?: string; readonly fetch?: typeof fetch },
): Promise<{ readonly ok: boolean; readonly checks: DeploymentCheck[]; readonly supabaseUrls: string[] }>
