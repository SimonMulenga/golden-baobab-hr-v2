const productionOrigin = 'https://golden-baobab-hr-v2.vercel.app'

/** Preserve configured preview/local origins while always allowing the app's production host. */
export function approvedAppOrigins(configured: string): string[] {
  return [...new Set([
    ...configured.split(',').map((value) => value.trim()).filter(Boolean),
    productionOrigin,
  ])]
}
