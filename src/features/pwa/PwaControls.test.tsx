import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { PwaProvider } from './pwa-runtime'
import { PwaInstallMenuAction, PwaPrompts } from './PwaControls'

describe('PWA installation controls', () => {
  it('prompts installation only after the user activates the install invitation', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined)
    const userChoice = Promise.resolve({ outcome: 'accepted' as const, platform: 'web' })
    render(<PwaProvider><MemoryRouter><PwaPrompts notification={null} onDismissNotification={vi.fn()}/><PwaInstallMenuAction/></MemoryRouter></PwaProvider>)

    const beforeInstallPrompt = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: typeof prompt; userChoice: typeof userChoice }
    beforeInstallPrompt.prompt = prompt
    beforeInstallPrompt.userChoice = userChoice
    fireEvent(window, beforeInstallPrompt)

    const invitation = await screen.findByRole('region', { name: 'Install Golden Baobab HR' })
    const invitationButton = within(invitation).getByRole('button', { name: 'Install app' })
    expect(prompt).not.toHaveBeenCalled()
    fireEvent.click(invitationButton)
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(screen.queryByText('Add Golden Baobab HR to your device for a focused, app-like workspace.')).not.toBeInTheDocument())
  })
})
