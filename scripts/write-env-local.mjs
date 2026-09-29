// Escribe .env.local con la URL y la clave PUBLISHABLE del Supabase local (`supabase status`).
// No escribe nunca la clave secret/service-role.
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const raw = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const status = JSON.parse(raw.slice(raw.indexOf('{')))
const url = status.API_URL
const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY
if (!url || !key) {
  console.error('Supabase local no está en marcha: npm run db:start')
  process.exit(1)
}
writeFileSync('.env.local', `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_PUBLISHABLE_KEY=${key}\n`)
console.log(`.env.local escrito para ${url}`)
