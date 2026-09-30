import { describe, expect, it } from 'vitest'
import { buildSquadMessage, formatMatchDay, whatsappShareUrl } from './whatsapp'

describe('mensaje de convocatoria para WhatsApp', () => {
  it('genera el formato acordado', () => {
    const message = buildSquadMessage({
      opponent: 'Málaga CF',
      date: '2026-09-12',
      kickoffTime: '18:00',
      location: 'Campo Municipal',
      players: [{ name: 'Pedro', number: 9 }, { name: 'Juan', number: 7 }, { name: 'Carlos', number: 3 }],
    })
    expect(message).toBe(
      ['VS MÁLAGA CF', 'Sábado 12/09 - 18:00 - Campo Municipal', '', 'CONVOCADOS:', '- Carlos', '- Juan', '- Pedro'].join(
        '\n',
      ),
    )
  })

  it('omite hora y ubicación si no están', () => {
    const message = buildSquadMessage({
      opponent: 'Atlético XXX',
      date: '2026-10-03',
      kickoffTime: null,
      location: '  ',
      players: [{ name: 'Juan', number: 7 }],
    })
    expect(message.split('\n').slice(0, 2)).toEqual(['VS ATLÉTICO XXX', 'Sábado 03/10'])
  })

  it('sin fecha, hora ni ubicación solo queda el rival y la lista', () => {
    const message = buildSquadMessage({ opponent: 'Rival', date: null, players: [{ name: 'Juan', number: 7 }] })
    expect(message).toBe(['VS RIVAL', '', 'CONVOCADOS:', '- Juan'].join('\n'))
  })

  it('sin fecha pero con hora y ubicación', () => {
    const message = buildSquadMessage({ opponent: 'Rival', kickoffTime: '10:00', location: 'Campo', players: [] })
    expect(message.split('\n')[1]).toBe('10:00 - Campo')
  })

  it('ordena por dorsal como NÚMERO (2 antes que 10), nunca como texto ni por minutos', () => {
    const numbers = [16, 2, 12, 1, 15, 10, 14, 11, 13]
    const message = buildSquadMessage({
      opponent: 'Rival',
      players: numbers.map((number) => ({ name: `Prueba${number}`, number })),
    })
    const listed = message.split('\n').slice(3)
    expect(listed).toEqual([1, 2, 10, 11, 12, 13, 14, 15, 16].map((n) => `- Prueba${n}`))
    expect(listed).not.toEqual([1, 10, 11, 12, 13, 14, 15, 16, 2].map((n) => `- Prueba${n}`))
  })

  it('el dorsal manda sobre el nombre; a igual dorsal (bajas), por nombre', () => {
    const message = buildSquadMessage({
      opponent: 'Rival',
      players: [
        { name: 'Álvaro', number: 10 },
        { name: 'Zoe', number: 2 },
        { name: 'Óscar', number: 5 },
        { name: 'Bruno', number: 5 },
      ],
    })
    expect(message.split('\n').slice(3)).toEqual(['- Zoe', '- Bruno', '- Óscar', '- Álvaro'])
  })

  it('el día no depende de la zona horaria del dispositivo', () => {
    expect(formatMatchDay('2026-09-12')).toBe('Sábado 12/09')
    expect(formatMatchDay('2026-09-13')).toBe('Domingo 13/09')
  })

  it('prepara la URL de WhatsApp con el texto codificado', () => {
    const url = whatsappShareUrl('VS MÁLAGA CF\n- Juan & Pedro')
    expect(url).toBe('https://wa.me/?text=VS%20M%C3%81LAGA%20CF%0A-%20Juan%20%26%20Pedro')
    expect(decodeURIComponent(new URL(url).searchParams.get('text')!)).toBe('VS MÁLAGA CF\n- Juan & Pedro')
  })
})
