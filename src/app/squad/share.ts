import { whatsappShareUrl } from './whatsapp'

/** Abre WhatsApp con el mensaje preparado; el entrenador elige el grupo o contacto. */
export function openWhatsApp(text: string): void {
  const url = whatsappShareUrl(text)
  const opened = window.open(url, '_blank')
  if (opened) opened.opener = null
  else window.location.href = url
}
