// Tipos de scripts/production-config.mjs (para los tests en TypeScript).
export function renderProductionConfig(
  values: {
    readonly projectRef?: string
    readonly appUrl?: string
    readonly remote?: 'production' | 'staging'
    readonly previewRedirect?: string
    readonly smtp?: boolean
  },
  template?: string,
): string
export function removeGeneratedBlock(config: string, remote: string): string
