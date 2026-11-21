const productionOrigins = [
  'https://golden-baobab-hr-v2.vercel.app',
  'https://goldenbaobab.luskamtravelagents.com',
  'https://goldenbaobab.byteandberry.com',
]

/** Preserve configured preview/local origins while always allowing the approved production hosts. */
export function approvedAppOrigins(configured: string): string[] {
  return [...new Set([
    ...configured.split(',').map((value) => value.trim()).filter(Boolean),
    ...productionOrigins,
  ])]
}
