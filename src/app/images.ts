/** Tamaño máximo del escudo: suficiente para verse nítido y ligero para guardar/sincronizar. */
const CREST_SIZE = 256

/**
 * Convierte la foto elegida (cámara o galería) en una imagen cuadrada pequeña como data URL.
 * Se recorta al centro para que cualquier foto quede bien en el círculo del escudo.
 */
export async function fileToCrestDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = CREST_SIZE
  canvas.height = CREST_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D no disponible')
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    CREST_SIZE,
    CREST_SIZE,
  )
  bitmap.close()
  // WebP si el navegador sabe codificarlo; si no, toDataURL devuelve PNG.
  return canvas.toDataURL('image/webp', 0.85)
}
