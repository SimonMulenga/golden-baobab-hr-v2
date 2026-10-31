const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function validateCompanyLogo(file: File): string | null {
  if (!ALLOWED_TYPES.has(file.type)) return 'Choose a PNG, JPG, or WebP image.'
  if (file.size <= 0 || file.size > MAX_SOURCE_BYTES) return 'Choose an image smaller than 10 MB.'
  return null
}

/** Re-encodes raster images as WebP, removing metadata and bounding dimensions. */
export async function normalizeCompanyLogo(file: File): Promise<File> {
  const issue = validateCompanyLogo(file)
  if (issue) throw new Error(issue)
  if (typeof createImageBitmap !== 'function') throw new Error('Image processing is unavailable in this browser.')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The selected image could not be processed.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('The selected image could not be encoded.')),
      'image/webp', 0.88,
    ))
    if (blob.size > MAX_OUTPUT_BYTES) throw new Error('The optimized logo must be smaller than 2 MB.')
    return new File([blob], 'company-logo.webp', { type: 'image/webp', lastModified: Date.now() })
  } finally { bitmap.close() }
}
