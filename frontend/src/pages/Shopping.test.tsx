import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRoutes } from '../services/api'
import type {
  MonthlyExpenseSummary,
  ShoppingItem,
  ShoppingList,
} from '../services/api'
import Shopping, { formatCurrency, parsePriceToCents } from './Shopping'


vi.mock('../services/api', () => ({
  apiRoutes: {
    getShoppingLists: vi.fn(),
    getShoppingHistory: vi.fn(),
    checkShoppingItem: vi.fn(),
    finishShoppingList: vi.fn(),
  },
}))

const uncheckedItem: ShoppingItem = {
  id: 11,
  shopping_list_id: 5,
  name: 'Arroz 5 kg',
  checked_at: null,
  price_cents: null,
  created_at: '2026-07-29T12:00:00',
}

const activeList: ShoppingList = {
  id: 5,
  user_id: 1,
  name: 'Compra mensal',
  kind: 'monthly',
  planned_date: '2026-08-05',
  completed_on: null,
  completed_at: null,
  total_cents: 0,
  created_at: '2026-07-29T12:00:00',
  items: [uncheckedItem],
}

const emptyHistory: MonthlyExpenseSummary = {
  month: '2026-07',
  total_cents: 0,
  purchase_count: 0,
  average_cents: 0,
  lists: [],
}

function mockInitialData(list: ShoppingList = activeList) {
  vi.mocked(apiRoutes.getShoppingLists).mockResolvedValue({
    data: [list],
  } as never)
  vi.mocked(apiRoutes.getShoppingHistory).mockResolvedValue({
    data: emptyHistory,
  } as never)
}


describe('shopping currency helpers', () => {
  it('converts Brazilian price input to integer cents', () => {
    expect(parsePriceToCents('12,90')).toBe(1290)
    expect(parsePriceToCents('R$ 1.234,56')).toBe(123456)
    expect(parsePriceToCents('8.50')).toBe(850)
    expect(parsePriceToCents('0')).toBe(0)
  })

  it('rejects invalid and unsafe price values', () => {
    expect(parsePriceToCents('')).toBeNull()
    expect(parsePriceToCents('-1')).toBeNull()
    expect(parsePriceToCents('12,999')).toBeNull()
    expect(parsePriceToCents('qualquer')).toBeNull()
  })

  it('formats cents as Brazilian reais', () => {
    expect(formatCurrency(1290)).toContain('12,90')
  })
})

describe('shopping assistant flow', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('checks an item with a price and records it in monthly history', async () => {
    mockInitialData()
    const checkedItem = {
      ...uncheckedItem,
      checked_at: '2026-07-29T12:05:00',
      price_cents: 2990,
    }
    const completedList = {
      ...activeList,
      completed_on: '2026-07-29',
      completed_at: '2026-07-29T12:06:00',
      total_cents: 2990,
      items: [checkedItem],
    }
    vi.mocked(apiRoutes.checkShoppingItem).mockResolvedValue({
      data: checkedItem,
    } as never)
    vi.mocked(apiRoutes.finishShoppingList).mockResolvedValue({
      data: completedList,
    } as never)
    vi.mocked(apiRoutes.getShoppingHistory)
      .mockResolvedValueOnce({ data: emptyHistory } as never)
      .mockResolvedValueOnce({
        data: {
          month: '2026-07',
          total_cents: 2990,
          purchase_count: 1,
          average_cents: 2990,
          lists: [completedList],
        },
      } as never)

    render(<Shopping userId={1} />)

    expect(await screen.findByRole('heading', { name: 'Compra mensal' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Peguei' }))
    fireEvent.change(screen.getByLabelText('Preço de Arroz 5 kg'), {
      target: { value: '29,90' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => {
      expect(apiRoutes.checkShoppingItem).toHaveBeenCalledWith(11, {
        checked: true,
        price_cents: 2990,
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Finalizar compra' }))
    expect(screen.getByRole('dialog', { name: 'Registrar este gasto?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar agora' }))

    expect(await screen.findByText('Histórico mensal')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getAllByText('R$ 29,90').length).toBeGreaterThan(0)
      expect(screen.getByText('Compra mensal')).toBeTruthy()
    })
  })

  it('keeps a finalization error visible inside the confirmation dialog', async () => {
    const checkedList = {
      ...activeList,
      items: [{
        ...uncheckedItem,
        checked_at: '2026-07-29T12:05:00',
        price_cents: 2990,
      }],
    }
    mockInitialData(checkedList)
    vi.mocked(apiRoutes.finishShoppingList).mockRejectedValue(
      new Error('network unavailable'),
    )

    render(<Shopping userId={1} />)

    expect(await screen.findByRole('heading', { name: 'Compra mensal' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar compra' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar agora' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível registrar este gasto.',
    )
    expect(screen.getByRole('dialog', { name: 'Registrar este gasto?' })).toBeTruthy()
  })
})
