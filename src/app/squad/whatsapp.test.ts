import { describe, expect, it } from 'vitest'
import { buildSquadMessage, formatMatchDay, whatsappShareUrl } from './whatsapp'

describe('mensaje de convocatoria para WhatsApp', () => {
  it('genera el formato acordado', () => {
    const message = buildSquadMessage({
      opponent: 'Málaga CF',
      date: '2026-09-12',
      kickoffTime: '18:00',
      location: 'Campo Municipal',
      players: [{ name: 'Pedro' }, { name: 'Juan' }, { name: 'Carlos' }],
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
      players: [{ name: 'Juan' }],
    })
    expect(message.split('\n').slice(0, 2)).toEqual(['VS ATLÉTICO XXX', 'Sábado 03/10'])
  })

  it('ordena alfabéticamente respetando acentos, no por minutos', () => {
    const message = buildSquadMessage({
      opponent: 'Rival',
      date: '2026-10-03',
      players: [{ name: 'Óscar' }, { name: 'Bruno' }, { name: 'Álvaro' }, { name: 'Ñaki' }, { name: 'Nico' }],
    })
    expect(message.split('\n').slice(4)).toEqual(['- Álvaro', '- Bruno', '- Nico', '- Ñaki', '- Óscar'])
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
