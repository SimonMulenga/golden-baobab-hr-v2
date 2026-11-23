import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { PayslipAccess } from './PayslipAccess'

const fetchMock = vi.hoisted(() => vi.fn())
vi.stubGlobal('fetch', fetchMock)

function chooseDate(day = '2', month = '4', year = '1990') {
  fireEvent.change(screen.getByLabelText('Day'), { target: { value: day } })
  fireEvent.change(screen.getByLabelText('Month'), { target: { value: month } })
  fireEvent.change(screen.getByLabelText('Year'), { target: { value: year } })
}

describe('employee payslip verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_synthetic_test_value')
    window.history.replaceState(null, '', '/payslip-access#token=synthetic-email-token')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:verified-payslip') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })

  it('shows only Day, Month and Year selectors and the simple DOB instruction', () => {
    render(<PayslipAccess />)
    expect(screen.getByText('Golden Baobab HR')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Secure Payslip Verification' })).toBeInTheDocument()
    expect(screen.getByText('For your security, please enter your date of birth to access your payslip.')).toBeInTheDocument()
    expect(screen.getByLabelText('Day')).toBeInTheDocument()
    expect(screen.getByLabelText('Month')).toBeInTheDocument()
    expect(screen.getByLabelText('Year')).toBeInTheDocument()
    expect(screen.queryByLabelText(/employee number/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/employee number/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify & View Payslip' })).toBeDisabled()
  })

  it('submits the date-only value with the existing emailed token and opens the private PDF', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(['%PDF synthetic'], { type: 'application/pdf' }),
    })
    render(<PayslipAccess />)
    chooseDate()
    fireEvent.click(screen.getByRole('button', { name: 'Verify & View Payslip' }))

    expect(await screen.findByTitle('Verified payslip PDF')).toHaveAttribute('src', 'blob:verified-payslip')
    expect(screen.getByRole('link', { name: 'Download secured payslip' })).toHaveAttribute('download', 'Golden-Baobab-Payslip.pdf')
    expect(screen.getByRole('status')).toHaveTextContent('four-digit birth year')
    const [, request] = fetchMock.mock.calls[0]
    const body = JSON.parse(request.body)
    expect(body).toEqual({ token: 'synthetic-email-token', dateOfBirth: '1990-04-02' })
    expect(body).not.toHaveProperty('employeeNumber')
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
  })

  it('shows one generic message when the token or date verification fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 })
    render(<PayslipAccess />)
    chooseDate()
    fireEvent.click(screen.getByRole('button', { name: 'Verify & View Payslip' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not verify your details. Please check your date of birth or contact HR.')
    expect(screen.queryByText(/employee number/i)).not.toBeInTheDocument()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('blocks access without a token while keeping existing hash-token links compatible', () => {
    window.history.replaceState(null, '', '/payslip-access')
    render(<PayslipAccess />)
    expect(screen.getByRole('alert')).toHaveTextContent('This link is missing or has expired.')
    expect(screen.getByRole('button', { name: 'Verify & View Payslip' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
