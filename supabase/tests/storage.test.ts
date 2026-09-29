import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { anonClient, createTeam, createUser, type TestTeam, type TestUser } from './helpers'

const png = readFileSync('public/pwa-64x64.png')

let member: TestUser
let outsider: TestUser
let team: TestTeam

beforeAll(async () => {
  ;[member, outsider] = await Promise.all([createUser('Isaac'), createUser('Otro')])
  team = await createTeam([{ user: member, role: 'admin' }])
  await createTeam([{ user: outsider, role: 'admin' }], 'Otro equipo')
})

const pathFor = (teamId: string) => `${teamId}/${randomUUID()}.png`

describe('escudos en Storage (bucket privado "crests")', () => {
  it('un miembro sube y descarga escudos de la carpeta de su equipo', async () => {
    const path = pathFor(team.teamId)
    const upload = await member.client.storage.from('crests').upload(path, png, { contentType: 'image/png' })
    expect(upload.error).toBeNull()
    const download = await member.client.storage.from('crests').download(path)
    expect(download.error).toBeNull()
    expect(download.data?.size).toBe(png.length)
  })

  it('otro equipo no puede leer ni subir en esa carpeta', async () => {
    const path = pathFor(team.teamId)
    await member.client.storage.from('crests').upload(path, png, { contentType: 'image/png' })
    expect((await outsider.client.storage.from('crests').download(path)).error).not.toBeNull()
    const intrusion = await outsider.client.storage
      .from('crests')
      .upload(pathFor(team.teamId), png, { contentType: 'image/png' })
    expect(intrusion.error).not.toBeNull()
  })

  it('sin sesión no hay acceso (el bucket no es público)', async () => {
    const path = pathFor(team.teamId)
    await member.client.storage.from('crests').upload(path, png, { contentType: 'image/png' })
    expect((await anonClient().storage.from('crests').download(path)).error).not.toBeNull()
    const publicUrl = anonClient().storage.from('crests').getPublicUrl(path).data.publicUrl
    expect((await fetch(publicUrl)).ok).toBe(false)
  })

  it('los escudos son inmutables: no se pueden sobrescribir ni borrar', async () => {
    const path = pathFor(team.teamId)
    await member.client.storage.from('crests').upload(path, png, { contentType: 'image/png' })
    const overwrite = await member.client.storage.from('crests').upload(path, png, { contentType: 'image/png', upsert: true })
    expect(overwrite.error).not.toBeNull()
    await member.client.storage.from('crests').remove([path])
    expect((await member.client.storage.from('crests').download(path)).error).toBeNull()
  })

  it('solo imágenes y como máximo 256 KB', async () => {
    const tooBig = await member.client.storage
      .from('crests')
      .upload(pathFor(team.teamId), new Uint8Array(300 * 1024), { contentType: 'image/png' })
    expect(tooBig.error).not.toBeNull()
    const notImage = await member.client.storage
      .from('crests')
      .upload(`${team.teamId}/${randomUUID()}.txt`, new TextEncoder().encode('hola'), { contentType: 'text/plain' })
    expect(notImage.error).not.toBeNull()
  })
})
