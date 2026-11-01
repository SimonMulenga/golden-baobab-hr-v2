import { approvedAppOrigins } from './origins.ts'

function assertEqual(actual: string[], expected: string[]) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

Deno.test('production payslip origin is always allowed', () => {
  assertEqual(approvedAppOrigins(''), ['https://golden-baobab-hr-v2.vercel.app'])
})

Deno.test('configured preview origins are retained and normalized', () => {
  assertEqual(approvedAppOrigins(' https://preview.example, https://localhost '), [
    'https://preview.example',
    'https://localhost',
    'https://golden-baobab-hr-v2.vercel.app',
  ])
})

Deno.test('duplicate production origin is not duplicated', () => {
  assertEqual(approvedAppOrigins('https://golden-baobab-hr-v2.vercel.app'), [
    'https://golden-baobab-hr-v2.vercel.app',
  ])
})
