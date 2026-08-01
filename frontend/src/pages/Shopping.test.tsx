import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRoutes } from '../services/api'
import type {
  MonthlyExpenseSummary,
  ShoppingItem,
  ShoppingList,
} from '../services/api'
import Shopping, {
  buildShoppingCsv,
  formatCurrency,
  parsePriceToCents,
} from './Shopping'


vi.mock('../services/api', () => ({
  apiRoutes: {
    getShoppingLists: vi.fn(),
    getShoppingHistory: vi.fn(),
    createShoppingList: vi.fn(),
    checkShoppingItem: vi.fn(),
    finishShoppingList: vi.fn(),
    setShoppingBudget: vi.fn(),
    getShoppingPriceHistory: vi.fn(),
    getShoppingShare: vi.fn(),
    createShoppingShareInvite: vi.fn(),
    redeemShoppingShareInvite: vi.fn(),
    deleteShoppingShare: vi.fn(),
  },
}))

const uncheckedItem: ShoppingItem = {
  id: 11,
  shopping_list_id: 5,
  name: 'Arroz 5 kg',
  quantity: 1,
  checked_at: null,
  unit_price_cents: null,
  price_cents: null,
  created_at: '2026-07-29T12:00:00',
}

const activeList: ShoppingList = {
  id: 5,
  user_id: 1,
  name: 'Compra mensal',
  kind: 'monthly',
  category: 'groceries',
  planned_date: '2026-08-05',
  budget_cents: 50_000,
  repeat_enabled: false,
  next_list_id: null,
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
  budget_cents: 50_000,
  planned_lists_cents: 50_000,
  planned_cents: 50_000,
  balance_cents: 50_000,
  previous_month_total_cents: 0,
  change_cents: 0,
  change_percent: null,
  category_totals: [],
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

  it('exports purchased item details as an Excel-friendly CSV', () => {
    const csv = buildShoppingCsv({
      ...emptyHistory,
      total_cents: 2990,
      lists: [{
        ...activeList,
        completed_on: '2026-07-29',
        completed_at: '2026-07-29T12:00:00',
        total_cents: 2990,
        items: [{
          ...uncheckedItem,
          quantity: 2,
          checked_at: '2026-07-29T12:00:00',
          unit_price_cents: 1495,
          price_cents: 2990,
        }],
      }],
    })

    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"Mercado"')
    expect(csv).toContain('"Arroz 5 kg"')
    expect(csv).toContain('"2"')
    expect(csv).toContain('"29,90"')
  })
})

describe('shopping assistant flow', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(apiRoutes.getShoppingShare).mockResolvedValue({
      data: { paired: false, invite_code: null, partner: null },
    } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('opens the create form requested by a PWA shortcut', async () => {
    mockInitialData()
    const handled = vi.fn()

    render(
      <Shopping
        userId={1}
        createRequested
        onCreateRequestHandled={handled}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Nova compra ou gasto' })).toBeTruthy()
    expect(handled).toHaveBeenCalledOnce()
  })

  it('checks an item with a price and records it in monthly history', async () => {
    mockInitialData()
    const checkedItem = {
      ...uncheckedItem,
      checked_at: '2026-07-29T12:05:00',
      unit_price_cents: 2990,
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
          budget_cents: 50_000,
          planned_lists_cents: 50_000,
          planned_cents: 50_000,
          balance_cents: 47_010,
          previous_month_total_cents: 0,
          change_cents: 2990,
          change_percent: null,
          category_totals: [{
            category: 'groceries',
            total_cents: 2990,
          }],
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
        quantity: 1,
        unit_price_cents: 2990,
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
        unit_price_cents: 2990,
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

  it('creates a categorized recurring list with its own budget', async () => {
    mockInitialData()
    const recurringList: ShoppingList = {
      ...activeList,
      category: 'child',
      kind: 'weekly',
      budget_cents: 30_000,
      repeat_enabled: true,
    }
    vi.mocked(apiRoutes.createShoppingList).mockResolvedValue({
      data: recurringList,
    } as never)

    render(<Shopping userId={1} />)
    await screen.findByRole('heading', { name: 'Compra mensal' })
    fireEvent.click(screen.getByRole('button', { name: 'Nova compra' }))
    const nameInput = screen.getByLabelText('Nome')
    expect(nameInput.hasAttribute('autofocus')).toBe(false)
    expect(
      (screen.getByRole('radio', { name: /Hoje/ }) as HTMLInputElement).checked,
    ).toBe(true)
    expect(screen.queryByLabelText('Escolha a data')).toBeNull()
    fireEvent.change(nameInput, {
      target: { value: 'Fraldas da filha' },
    })
    fireEvent.change(screen.getByLabelText('Tipo de compra'), {
      target: { value: 'weekly' },
    })
    fireEvent.change(screen.getByLabelText('Categoria'), {
      target: { value: 'child' },
    })
    fireEvent.change(screen.getByLabelText('Limite desta compra'), {
      target: { value: '300,00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar lista' }))

    await waitFor(() => {
      expect(apiRoutes.createShoppingList).toHaveBeenCalledWith(1, {
        name: 'Fraldas da filha',
        kind: 'weekly',
        category: 'child',
        planned_date: '2026-07-29',
        budget_cents: 30_000,
        repeat_enabled: true,
      })
    })
  })

  it('reveals the new purchase form without focusing a text input', async () => {
    mockInitialData()
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    const originalRequestAnimationFrame = window.requestAnimationFrame
    const originalCancelAnimationFrame = window.cancelAnimationFrame

    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
    window.requestAnimationFrame = callback => {
      callback(0)
      return 1
    }
    window.cancelAnimationFrame = vi.fn()

    try {
      render(<Shopping userId={1} />)
      await screen.findByRole('heading', { name: 'Compra mensal' })
      fireEvent.click(screen.getByRole('button', { name: 'Nova compra' }))

      const formHeading = screen.getByRole('heading', {
        name: 'Nova compra ou gasto',
      })
      const formPanel = formHeading.closest('section')
      const nameInput = screen.getByLabelText('Nome')

      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({
          behavior: 'smooth',
          block: 'start',
        })
      })
      expect(document.activeElement).toBe(formPanel)
      expect(document.activeElement).not.toBe(nameInput)
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: originalScrollIntoView,
      })
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
    }
  })

  it('uses tomorrow as planned date without opening the calendar input', async () => {
    mockInitialData()
    vi.mocked(apiRoutes.createShoppingList).mockResolvedValue({
      data: {
        ...activeList,
        name: 'Compra de amanhã',
        planned_date: '2026-07-30',
      },
    } as never)

    render(<Shopping userId={1} />)
    await screen.findByRole('heading', { name: 'Compra mensal' })
    fireEvent.click(screen.getByRole('button', { name: 'Nova compra' }))
    fireEvent.change(screen.getByLabelText('Nome'), {
      target: { value: 'Compra de amanhã' },
    })
    fireEvent.click(screen.getByRole('radio', { name: /Amanhã/ }))

    expect(screen.queryByLabelText('Escolha a data')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Criar lista' }))

    await waitFor(() => {
      expect(apiRoutes.createShoppingList).toHaveBeenCalledWith(1, {
        name: 'Compra de amanhã',
        kind: 'monthly',
        category: 'groceries',
        planned_date: '2026-07-30',
        budget_cents: null,
        repeat_enabled: true,
      })
    })
  })

  it('shows the calendar only for another date and sends the chosen day', async () => {
    mockInitialData()
    vi.mocked(apiRoutes.createShoppingList).mockResolvedValue({
      data: {
        ...activeList,
        name: 'Compra agendada',
        planned_date: '2026-08-12',
      },
    } as never)

    render(<Shopping userId={1} />)
    await screen.findByRole('heading', { name: 'Compra mensal' })
    fireEvent.click(screen.getByRole('button', { name: 'Nova compra' }))
    expect(screen.queryByLabelText('Escolha a data')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: /Outra data/ }))
    const customDate = screen.getByLabelText('Escolha a data')
    fireEvent.change(screen.getByLabelText('Nome'), {
      target: { value: 'Compra agendada' },
    })
    fireEvent.change(customDate, {
      target: { value: '2026-08-12' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar lista' }))

    await waitFor(() => {
      expect(apiRoutes.createShoppingList).toHaveBeenCalledWith(1, {
        name: 'Compra agendada',
        kind: 'monthly',
        category: 'groceries',
        planned_date: '2026-08-12',
        budget_cents: null,
        repeat_enabled: true,
      })
    })
  })

  it('saves a monthly budget and shows price history by item name', async () => {
    mockInitialData()
    vi.mocked(apiRoutes.setShoppingBudget).mockResolvedValue({
      data: { month: '2026-07', budget_cents: 150_000 },
    } as never)
    vi.mocked(apiRoutes.getShoppingPriceHistory).mockResolvedValue({
      data: {
        item_name: 'Arroz 5 kg',
        entries: [],
      },
    } as never)

    render(<Shopping userId={1} />)
    await screen.findByRole('heading', { name: 'Compra mensal' })

    fireEvent.click(
      screen.getByRole('button', { name: 'Histórico de preço de Arroz 5 kg' }),
    )
    expect(await screen.findByText(
      'Este será o primeiro preço registrado para este item.',
    )).toBeTruthy()
    expect(apiRoutes.getShoppingPriceHistory).toHaveBeenCalledWith(
      1,
      'Arroz 5 kg',
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Histórico' }))
    const budgetInput = await screen.findByLabelText('Orçamento de Julho de 2026')
    fireEvent.change(budgetInput, { target: { value: '1.500,00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar orçamento' }))

    await waitFor(() => {
      expect(apiRoutes.setShoppingBudget).toHaveBeenCalledWith(
        1,
        '2026-07',
        150_000,
      )
    })
  })
})
