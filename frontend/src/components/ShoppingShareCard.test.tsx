import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRoutes } from '../services/api'
import ShoppingShareCard from './ShoppingShareCard'

vi.mock('../services/api', () => ({
  apiRoutes: {
    getShoppingShare: vi.fn(),
    createShoppingShareInvite: vi.fn(),
    redeemShoppingShareInvite: vi.fn(),
    deleteShoppingShare: vi.fn(),
  },
}))

describe('ShoppingShareCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(apiRoutes.getShoppingShare).mockResolvedValue({
      data: { paired: false, invite_code: null, partner: null },
    } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates a short invite code for the other profile', async () => {
    vi.mocked(apiRoutes.createShoppingShareInvite).mockResolvedValue({
      data: { paired: false, invite_code: 'ABCD2EFG', partner: null },
    } as never)

    render(<ShoppingShareCard userId={1} onShareChanged={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar código' }))

    expect(await screen.findByText('ABCD-2EFG')).toBeTruthy()
    expect(apiRoutes.createShoppingShareInvite).toHaveBeenCalledWith(1)
  })

  it('redeems a code and refreshes the shared lists', async () => {
    const changed = vi.fn()
    vi.mocked(apiRoutes.redeemShoppingShareInvite).mockResolvedValue({
      data: {
        paired: true,
        invite_code: null,
        partner: { id: 2, name: 'Itayna', initials: 'I' },
      },
    } as never)

    render(<ShoppingShareCard userId={1} onShareChanged={changed} />)
    const input = await screen.findByLabelText('Código recebido')
    fireEvent.change(input, { target: { value: 'abcd-2efg' } })
    fireEvent.click(screen.getByRole('button', { name: 'Conectar' }))

    await waitFor(() => {
      expect(apiRoutes.redeemShoppingShareInvite).toHaveBeenCalledWith(1, 'ABCD-2EFG')
    })
    expect(changed).toHaveBeenCalledOnce()
    expect(screen.getByRole('heading', { name: 'Compras com Itayna' })).toBeTruthy()
  })
})
