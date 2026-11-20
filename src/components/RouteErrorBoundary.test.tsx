import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { RouteErrorBoundary } from './RouteErrorBoundary'

function BrokenRoute(): never {
  throw new Error('synthetic route failure')
}

describe('RouteErrorBoundary', () => {
  it('replaces a failed route with recovery actions', () => {
    render(<MemoryRouter><RouteErrorBoundary><BrokenRoute /></RouteErrorBoundary></MemoryRouter>)

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'We couldn’t open this page' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
    expect(screen.getByRole('link', { name: /return to overview/i }).getAttribute('href')).toBe('/')
  })
})
