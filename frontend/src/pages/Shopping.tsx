import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Download,
  History,
  ListPlus,
  Pencil,
  Plus,
  ReceiptText,
  Repeat2,
  RotateCcw,
  Save,
  ShoppingBasket,
  Sparkles,
  Tags,
  Trash2,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
import { apiRoutes } from '../services/api'
import type {
  MonthlyExpenseSummary,
  ShoppingCategory,
  ShoppingItem,
  ShoppingKind,
  ShoppingList,
  ShoppingPriceHistory,
} from '../services/api'
import { toLocalDateValue } from '../utils/date'
import { useShoppingCreateForm } from '../hooks/useShoppingCreateForm'
import '../styles/finance-upgrade.css'


interface ShoppingProps {
  userId: number
}

type ShoppingView = 'active' | 'history'
const KIND_LABELS: Record<ShoppingKind, string> = {
  monthly: 'Mensal',
  weekly: 'Semanal',
  one_time: 'Avulsa',
}

const CATEGORY_LABELS: Record<ShoppingCategory, string> = {
  groceries: 'Mercado',
  child: 'Filha e fraldas',
  home: 'Casa',
  personal: 'Pessoal',
  health: 'Saúde',
  transport: 'Transporte',
  other: 'Outro',
}

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS) as Array<
  [ShoppingCategory, string]
>

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function formatCurrency(cents: number): string {
  return currencyFormatter.format(cents / 100)
}

export function parsePriceToCents(input: string): number | null {
  const compact = input
    .trim()
    .replace(/^R\$\s*/i, '')
    .replace(/\s/g, '')
  if (!compact) return null

  const normalized = compact.includes(',')
    ? compact.replace(/\./g, '').replace(',', '.')
    : compact
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null

  const cents = Math.round(Number(normalized) * 100)
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100_000_000) {
    return null
  }
  return cents
}

function formatDate(dateValue: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${dateValue}T12:00:00`))
}

function formatMonth(monthValue: string): string {
  const [year, month] = monthValue.split('-').map(Number)
  const formatted = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1))
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

function localDateWithOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toLocalDateValue(date)
}

function formatShortDate(dateValue: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(`${dateValue}T12:00:00`))
}

function listRunningTotal(shoppingList: ShoppingList): number {
  return shoppingList.items.reduce(
    (total, item) => total + (item.checked_at ? item.price_cents || 0 : 0),
    0,
  )
}

function checkedItemCount(shoppingList: ShoppingList): number {
  return shoppingList.items.filter(item => item.checked_at).length
}

function normalizeShoppingItem(item: ShoppingItem): ShoppingItem {
  const quantity = item.quantity || 1
  return {
    ...item,
    quantity,
    unit_price_cents:
      item.unit_price_cents
      ?? (item.price_cents === null ? null : Math.round(item.price_cents / quantity)),
  }
}

function normalizeShoppingList(shoppingList: ShoppingList): ShoppingList {
  return {
    ...shoppingList,
    category: shoppingList.category || 'other',
    budget_cents: shoppingList.budget_cents ?? null,
    repeat_enabled: shoppingList.repeat_enabled ?? false,
    next_list_id: shoppingList.next_list_id ?? null,
    items: (shoppingList.items || []).map(normalizeShoppingItem),
  }
}

function normalizeMonthlySummary(
  summary: MonthlyExpenseSummary,
): MonthlyExpenseSummary {
  const plannedLists = summary.planned_lists_cents || 0
  const budget = summary.budget_cents || 0
  const planned = summary.planned_cents ?? (budget || plannedLists)
  return {
    ...summary,
    budget_cents: budget,
    planned_lists_cents: plannedLists,
    planned_cents: planned,
    balance_cents: summary.balance_cents ?? (planned - summary.total_cents),
    previous_month_total_cents: summary.previous_month_total_cents || 0,
    change_cents: summary.change_cents ?? summary.total_cents,
    change_percent: summary.change_percent ?? null,
    category_totals: summary.category_totals || [],
    lists: (summary.lists || []).map(normalizeShoppingList),
  }
}

function csvCell(value: string | number): string {
  const text = String(value)
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replace(/"/g, '""')}"`
}

export function buildShoppingCsv(summary: MonthlyExpenseSummary): string {
  const rows = [
    ['Data', 'Compra', 'Categoria', 'Item', 'Quantidade', 'Preço unitário', 'Total'],
  ]
  for (const shoppingList of summary.lists) {
    for (const item of shoppingList.items.filter(entry => entry.checked_at)) {
      rows.push([
        shoppingList.completed_on || shoppingList.planned_date,
        shoppingList.name,
        CATEGORY_LABELS[shoppingList.category],
        item.name,
        String(item.quantity),
        ((item.unit_price_cents || 0) / 100).toFixed(2).replace('.', ','),
        ((item.price_cents || 0) / 100).toFixed(2).replace('.', ','),
      ].map(String))
    }
  }
  return `\uFEFF${rows.map(row => row.map(csvCell).join(';')).join('\r\n')}`
}

export default function Shopping({ userId }: ShoppingProps) {
  const currentMonth = toLocalDateValue().slice(0, 7)
  const [view, setView] = useState<ShoppingView>('active')
  const [lists, setLists] = useState<ShoppingList[]>([])
  const [history, setHistory] = useState<MonthlyExpenseSummary | null>(null)
  const [currentMonthSummary, setCurrentMonthSummary] =
    useState<MonthlyExpenseSummary | null>(null)
  const [selectedListId, setSelectedListId] = useState<number | null>(null)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const {
    showCreateForm,
    setShowCreateForm,
    createFormRevealRequest,
    setCreateFormRevealRequest,
    newListName,
    setNewListName,
    newListDate,
    setNewListDate,
    newListDateChoice,
    setNewListDateChoice,
    newListKind,
    setNewListKind,
    newListCategory,
    setNewListCategory,
    newListBudget,
    setNewListBudget,
    newListRepeat,
    setNewListRepeat,
    newItemName,
    setNewItemName,
    newItemQuantity,
    setNewItemQuantity,
    reset: resetCreateForm,
  } = useShoppingCreateForm()
  const [priceItemId, setPriceItemId] = useState<number | null>(null)
  const [priceDraft, setPriceDraft] = useState('')
  const [priceQuantityDraft, setPriceQuantityDraft] = useState('1')
  const [priceError, setPriceError] = useState('')
  const [budgetDraft, setBudgetDraft] = useState('')
  const [budgetSaving, setBudgetSaving] = useState(false)
  const [priceHistory, setPriceHistory] = useState<ShoppingPriceHistory | null>(null)
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false)
  const [recurrenceNotice, setRecurrenceNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyItemId, setBusyItemId] = useState<number | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [reopeningListId, setReopeningListId] = useState<number | null>(null)
  const [confirmingFinish, setConfirmingFinish] = useState(false)
  const [finishError, setFinishError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [error, setError] = useState('')
  const initialRequestIdRef = useRef(0)
  const historyRequestIdRef = useRef(0)
  const itemOperationRef = useRef<number | null>(null)
  const finishDialogRef = useRef<HTMLElement | null>(null)
  const createPanelRef = useRef<HTMLElement | null>(null)

  const selectedList = useMemo(
    () => lists.find(item => item.id === selectedListId) || null,
    [lists, selectedListId],
  )

  useEffect(() => {
    const requestId = ++initialRequestIdRef.current
    historyRequestIdRef.current += 1
    itemOperationRef.current = null
    setView('active')
    setLists([])
    setHistory(null)
    setCurrentMonthSummary(null)
    setSelectedListId(null)
    setSelectedMonth(currentMonth)
    resetCreateForm()
    setPriceItemId(null)
    setPriceDraft('')
    setPriceQuantityDraft('1')
    setPriceError('')
    setBudgetDraft('')
    setBudgetSaving(false)
    setPriceHistory(null)
    setPriceHistoryLoading(false)
    setRecurrenceNotice('')
    setSaving(false)
    setBusyItemId(null)
    setFinalizing(false)
    setReopeningListId(null)
    setConfirmingFinish(false)
    setFinishError('')
    setHistoryLoading(false)
    setError('')
    void loadInitialData(requestId)
  }, [userId])

  useEffect(() => {
    if (view === 'history') {
      void loadHistory(selectedMonth)
    }
  }, [selectedMonth, userId, view])

  useEffect(() => {
    if (
      view !== 'active'
      || !showCreateForm
      || createFormRevealRequest === 0
    ) {
      return
    }

    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const panel = createPanelRef.current
        if (!panel) return

        const reduceMotion = window.matchMedia?.(
          '(prefers-reduced-motion: reduce)',
        ).matches
        panel.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'start',
        })
        panel.focus({ preventScroll: true })
      })
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [createFormRevealRequest, showCreateForm, view])

  useEffect(() => {
    if (!confirmingFinish) return

    const dialog = finishDialogRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled)'
    const firstFocusable = dialog?.querySelector<HTMLElement>(focusableSelector)
    firstFocusable?.focus()

    function handleDialogKeys(event: KeyboardEvent) {
      if (event.key === 'Escape' && !finalizing) {
        setConfirmingFinish(false)
        setFinishError('')
        return
      }
      if (event.key !== 'Tab' || !dialog) return

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleDialogKeys)
    return () => {
      document.removeEventListener('keydown', handleDialogKeys)
      previouslyFocused?.focus()
    }
  }, [confirmingFinish, finalizing])

  async function loadInitialData(requestId: number) {
    setLoading(true)
    setError('')
    try {
      const [activeResponse, historyResponse] = await Promise.all([
        apiRoutes.getShoppingLists(userId, false),
        apiRoutes.getShoppingHistory(userId, currentMonth),
      ])
      if (requestId !== initialRequestIdRef.current) return
      const normalizedLists = activeResponse.data.map(normalizeShoppingList)
      const normalizedHistory = normalizeMonthlySummary(historyResponse.data)
      setLists(normalizedLists)
      setHistory(normalizedHistory)
      setCurrentMonthSummary(normalizedHistory)
      setBudgetDraft(
        normalizedHistory.budget_cents > 0
          ? (normalizedHistory.budget_cents / 100).toFixed(2).replace('.', ',')
          : '',
      )
      setSelectedListId(current =>
        normalizedLists.some(item => item.id === current)
          ? current
          : normalizedLists[0]?.id || null,
      )
    } catch (loadError) {
      if (requestId !== initialRequestIdRef.current) return
      console.error('Failed to load shopping assistant:', loadError)
      setError('Não foi possível carregar suas compras agora.')
    } finally {
      if (requestId === initialRequestIdRef.current) {
        setLoading(false)
      }
    }
  }

  async function loadActiveLists(preferredId?: number) {
    const response = await apiRoutes.getShoppingLists(userId, false)
    const normalizedLists = response.data.map(normalizeShoppingList)
    setLists(normalizedLists)
    setSelectedListId(current => {
      if (preferredId && normalizedLists.some(item => item.id === preferredId)) {
        return preferredId
      }
      if (normalizedLists.some(item => item.id === current)) return current
      return normalizedLists[0]?.id || null
    })
  }

  async function loadHistory(month: string) {
    const requestId = ++historyRequestIdRef.current
    setHistoryLoading(true)
    setError('')
    try {
      const response = await apiRoutes.getShoppingHistory(userId, month)
      if (requestId !== historyRequestIdRef.current) return
      const normalizedHistory = normalizeMonthlySummary(response.data)
      setHistory(normalizedHistory)
      setBudgetDraft(
        normalizedHistory.budget_cents > 0
          ? (normalizedHistory.budget_cents / 100).toFixed(2).replace('.', ',')
          : '',
      )
      if (month === currentMonth) {
        setCurrentMonthSummary(normalizedHistory)
      }
    } catch (historyError) {
      if (requestId !== historyRequestIdRef.current) return
      console.error('Failed to load shopping history:', historyError)
      setError('Não foi possível carregar o histórico deste mês.')
    } finally {
      if (requestId === historyRequestIdRef.current) {
        setHistoryLoading(false)
      }
    }
  }

  function updateItemInState(updatedItem: ShoppingItem) {
    const normalizedItem = normalizeShoppingItem(updatedItem)
    setLists(current => current.map(shoppingList => (
      shoppingList.id === normalizedItem.shopping_list_id
        ? {
            ...shoppingList,
            items: shoppingList.items.map(item =>
              item.id === normalizedItem.id ? normalizedItem : item
            ),
          }
        : shoppingList
    )))
  }

  async function createList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newListName.trim()) return
    if (saving || itemOperationRef.current !== null || finalizing) return
    const plannedDate = newListDateChoice === 'today'
      ? localDateWithOffset(0)
      : newListDateChoice === 'tomorrow'
        ? localDateWithOffset(1)
        : newListDate
    const budgetCents = newListBudget.trim()
      ? parsePriceToCents(newListBudget)
      : null
    if (newListBudget.trim() && budgetCents === null) {
      setError('Digite um orçamento válido para esta compra.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const response = await apiRoutes.createShoppingList(userId, {
        name: newListName.trim(),
        kind: newListKind,
        category: newListCategory,
        planned_date: plannedDate,
        budget_cents: budgetCents,
        repeat_enabled: newListKind !== 'one_time' && newListRepeat,
      })
      const createdList = normalizeShoppingList(response.data)
      setLists(current => [...current, createdList].sort(
        (a, b) => a.planned_date.localeCompare(b.planned_date),
      ))
      setSelectedListId(createdList.id)
      setNewListName('')
      setNewListBudget('')
      setNewListDateChoice('today')
      setNewListDate(localDateWithOffset(0))
      setShowCreateForm(false)
    } catch (createError) {
      console.error('Failed to create shopping list:', createError)
      setError('Não foi possível criar esta compra.')
    } finally {
      setSaving(false)
    }
  }

  function openCreateForm() {
    setView('active')
    setShowCreateForm(true)
    setCreateFormRevealRequest(current => current + 1)
  }

  async function deleteList(shoppingList: ShoppingList) {
    if (!window.confirm(`Excluir a lista "${shoppingList.name}"?`)) return
    if (saving || itemOperationRef.current !== null || finalizing) return
    setSaving(true)
    try {
      await apiRoutes.deleteShoppingList(shoppingList.id)
      await loadActiveLists()
    } catch (deleteError) {
      console.error('Failed to delete shopping list:', deleteError)
      setError('Não foi possível excluir esta lista.')
    } finally {
      setSaving(false)
    }
  }

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedList || !newItemName.trim()) return
    if (saving || itemOperationRef.current !== null || finalizing) return
    const quantity = Number(newItemQuantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      setError('A quantidade deve ser um número entre 1 e 999.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const response = await apiRoutes.addShoppingItem(
        selectedList.id,
        newItemName.trim(),
        quantity,
      )
      setLists(current => current.map(shoppingList => (
        shoppingList.id === selectedList.id
          ? {
              ...shoppingList,
              items: [
                ...shoppingList.items,
                normalizeShoppingItem(response.data),
              ],
            }
          : shoppingList
      )))
      setNewItemName('')
      setNewItemQuantity('1')
    } catch (itemError) {
      console.error('Failed to create shopping item:', itemError)
      setError('Não foi possível adicionar este item.')
    } finally {
      setSaving(false)
    }
  }

  function startPriceEntry(item: ShoppingItem) {
    if (itemOperationRef.current !== null || saving || finalizing) return
    setPriceItemId(item.id)
    setPriceDraft(
      item.unit_price_cents === null
        ? ''
        : (item.unit_price_cents / 100).toFixed(2).replace('.', ','),
    )
    setPriceQuantityDraft(String(item.quantity))
    setPriceError('')
  }

  async function saveItemPrice(event: FormEvent<HTMLFormElement>, item: ShoppingItem) {
    event.preventDefault()
    if (itemOperationRef.current !== null || saving || finalizing) return
    const priceCents = parsePriceToCents(priceDraft)
    if (priceCents === null) {
      setPriceError('Digite um preço válido, por exemplo 12,90.')
      return
    }
    const quantity = Number(priceQuantityDraft)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      setPriceError('A quantidade deve ficar entre 1 e 999.')
      return
    }

    itemOperationRef.current = item.id
    setBusyItemId(item.id)
    setPriceError('')
    try {
      const response = await apiRoutes.checkShoppingItem(item.id, {
        checked: true,
        quantity,
        unit_price_cents: priceCents,
      })
      updateItemInState(response.data)
      if (priceItemId === item.id) {
        setPriceItemId(null)
        setPriceDraft('')
        setPriceQuantityDraft('1')
      }
    } catch (priceSaveError) {
      console.error('Failed to save item price:', priceSaveError)
      setPriceError('Não foi possível salvar este preço.')
    } finally {
      if (itemOperationRef.current === item.id) {
        itemOperationRef.current = null
        setBusyItemId(null)
      }
    }
  }

  async function uncheckItem(item: ShoppingItem) {
    if (itemOperationRef.current !== null || saving || finalizing) return
    itemOperationRef.current = item.id
    setBusyItemId(item.id)
    setError('')
    try {
      const response = await apiRoutes.checkShoppingItem(item.id, {
        checked: false,
      })
      updateItemInState(response.data)
    } catch (uncheckError) {
      console.error('Failed to uncheck shopping item:', uncheckError)
      setError('Não foi possível desmarcar este item.')
    } finally {
      if (itemOperationRef.current === item.id) {
        itemOperationRef.current = null
        setBusyItemId(null)
      }
    }
  }

  async function deleteItem(item: ShoppingItem) {
    if (!selectedList || !window.confirm(`Remover "${item.name}" da lista?`)) return
    if (itemOperationRef.current !== null || saving || finalizing) return
    itemOperationRef.current = item.id
    setBusyItemId(item.id)
    try {
      await apiRoutes.deleteShoppingItem(item.id)
      setLists(current => current.map(shoppingList => (
        shoppingList.id === selectedList.id
          ? {
              ...shoppingList,
              items: shoppingList.items.filter(currentItem => currentItem.id !== item.id),
            }
          : shoppingList
      )))
    } catch (deleteError) {
      console.error('Failed to delete shopping item:', deleteError)
      setError('Não foi possível remover este item.')
    } finally {
      if (itemOperationRef.current === item.id) {
        itemOperationRef.current = null
        setBusyItemId(null)
      }
    }
  }

  async function saveMonthlyBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cents = parsePriceToCents(budgetDraft)
    if (cents === null) {
      setError('Digite um orçamento mensal válido.')
      return
    }
    setBudgetSaving(true)
    setError('')
    try {
      await apiRoutes.setShoppingBudget(userId, selectedMonth, cents)
      await loadHistory(selectedMonth)
    } catch (budgetError) {
      console.error('Failed to save shopping budget:', budgetError)
      setError('Não foi possível salvar o orçamento deste mês.')
    } finally {
      setBudgetSaving(false)
    }
  }

  async function showPriceHistory(item: ShoppingItem) {
    if (priceHistoryLoading) return
    setPriceHistoryLoading(true)
    setError('')
    try {
      const response = await apiRoutes.getShoppingPriceHistory(userId, item.name)
      setPriceHistory(response.data)
    } catch (historyError) {
      console.error('Failed to load item price history:', historyError)
      setError('Não foi possível consultar o histórico de preço deste item.')
    } finally {
      setPriceHistoryLoading(false)
    }
  }

  function exportMonthlyCsv(summary: MonthlyExpenseSummary) {
    const blob = new Blob([buildShoppingCsv(summary)], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `gastos-${summary.month}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  function requestFinish() {
    if (!selectedList) return
    if (saving || busyItemId !== null || priceItemId !== null) {
      setError('Conclua a alteração em andamento antes de finalizar.')
      return
    }
    const checkedCount = checkedItemCount(selectedList)
    if (checkedCount === 0) {
      setError('Marque pelo menos um item com preço antes de finalizar.')
      return
    }
    setFinishError('')
    setConfirmingFinish(true)
  }

  async function finishList() {
    if (!selectedList || saving || busyItemId !== null || priceItemId !== null) return
    setFinalizing(true)
    setError('')
    setFinishError('')
    try {
      const response = await apiRoutes.finishShoppingList(selectedList.id)
      const completedMonth = (response.data.completed_on || toLocalDateValue()).slice(0, 7)
      if (response.data.next_list_id) {
        setRecurrenceNotice(
          `A próxima lista ${KIND_LABELS[response.data.kind].toLowerCase()} já foi criada.`,
        )
      }
      if (response.data.next_list_id) {
        await loadActiveLists(response.data.next_list_id)
      } else {
        setLists(current => current.filter(item => item.id !== selectedList.id))
        setSelectedListId(current => {
          if (current !== selectedList.id) return current
          return lists.find(item => item.id !== selectedList.id)?.id || null
        })
      }
      setSelectedMonth(completedMonth)
      setHistory(null)
      setHistoryLoading(true)
      setView('history')
      setConfirmingFinish(false)
    } catch (finishError) {
      console.error('Failed to finish shopping list:', finishError)
      setFinishError('Não foi possível registrar este gasto. Tente novamente.')
    } finally {
      setFinalizing(false)
    }
  }

  async function reopenList(shoppingList: ShoppingList) {
    if (reopeningListId !== null) return
    setReopeningListId(shoppingList.id)
    setError('')
    try {
      const response = await apiRoutes.reopenShoppingList(shoppingList.id)
      await Promise.all([
        loadActiveLists(response.data.id),
        loadHistory(selectedMonth),
      ])
      setSelectedListId(response.data.id)
      setView('active')
    } catch (reopenError) {
      console.error('Failed to reopen shopping list:', reopenError)
      setError('Não foi possível reabrir esta compra para correção.')
    } finally {
      setReopeningListId(null)
    }
  }

  const visibleHistory =
    history?.month === selectedMonth ? history : null
  const monthTotal = currentMonthSummary?.total_cents || 0
  const monthPurchaseCount = currentMonthSummary?.purchase_count || 0
  const monthPlanned = currentMonthSummary?.planned_cents || 0
  const monthBalance = currentMonthSummary?.balance_cents || 0
  const hasPendingMutation =
    saving
    || budgetSaving
    || busyItemId !== null
    || finalizing
    || reopeningListId !== null

  if (loading) {
    return (
      <div className="view" data-view="shopping">
        <section className="panel shopping-loading" role="status">
          <ShoppingBasket size={28} aria-hidden="true" />
          <strong>Preparando seu assistente de compras...</strong>
        </section>
      </div>
    )
  }

  return (
    <div className="view shopping-view" data-view="shopping">
      <section className="shopping-hero">
        <div className="shopping-hero-copy">
          <p className="section-label">Compras e gastos</p>
          <h2>Planeje, confira e saiba quanto gastou</h2>
          <p>
            Monte sua lista antes de sair. No mercado, marque cada item com o
            preço e acompanhe o total em tempo real.
          </p>
          <button
            className="shopping-hero-action"
            type="button"
            disabled={hasPendingMutation}
            onClick={openCreateForm}
          >
            <Plus size={18} aria-hidden="true" />
            Nova compra
          </button>
        </div>
        <div className="shopping-finance-snapshot">
          <article className="shopping-month-total">
            <span className="shopping-month-icon" aria-hidden="true">
              <WalletCards size={23} />
            </span>
            <div>
              <small>Gasto em {formatMonth(currentMonth)}</small>
              <strong>{formatCurrency(monthTotal)}</strong>
              <span>
                {monthPurchaseCount} {monthPurchaseCount === 1 ? 'compra finalizada' : 'compras finalizadas'}
              </span>
            </div>
          </article>
          <div className="shopping-balance-row">
            <span>
              Planejado
              <strong>{formatCurrency(monthPlanned)}</strong>
            </span>
            <span className={monthBalance < 0 ? 'is-negative' : ''}>
              Saldo
              <strong>{formatCurrency(monthBalance)}</strong>
            </span>
          </div>
        </div>
      </section>

      <div className="shopping-view-switch" role="tablist" aria-label="Seções de compras">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'active'}
          className={view === 'active' ? 'active' : ''}
          onClick={() => setView('active')}
          disabled={hasPendingMutation}
        >
          <ShoppingBasket size={17} aria-hidden="true" />
          Planejadas
          <span>{lists.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'history'}
          className={view === 'history' ? 'active' : ''}
          onClick={() => setView('history')}
          disabled={hasPendingMutation}
        >
          <ReceiptText size={17} aria-hidden="true" />
          Histórico
        </button>
      </div>

      {error && (
        <div className="shopping-error" role="alert">
          {error}
          <button type="button" onClick={() => setError('')}>Fechar</button>
        </div>
      )}

      {recurrenceNotice && (
        <div className="shopping-success" role="status">
          <Repeat2 size={17} aria-hidden="true" />
          {recurrenceNotice}
          <button type="button" onClick={() => setRecurrenceNotice('')}>Fechar</button>
        </div>
      )}

      {confirmingFinish && selectedList && (
        <div className="shopping-confirm-backdrop" role="presentation">
          <section
            ref={finishDialogRef}
            className="shopping-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shopping-finish-title"
          >
            <span className="shopping-confirm-icon" aria-hidden="true">
              <CircleDollarSign size={25} />
            </span>
            <div>
              <p className="section-label">Resumo da compra</p>
              <h2 id="shopping-finish-title">Registrar este gasto?</h2>
              <p>
                {checkedItemCount(selectedList)} itens comprados
                {selectedList.items.length > checkedItemCount(selectedList)
                  ? ` · ${selectedList.items.length - checkedItemCount(selectedList)} não comprados`
                  : ''}
              </p>
            </div>
            <div className="shopping-confirm-total">
              <span>Total que entrará no histórico</span>
              <strong>{formatCurrency(listRunningTotal(selectedList))}</strong>
            </div>
            {selectedList.repeat_enabled && (
              <p className="shopping-confirm-repeat">
                <Repeat2 size={16} aria-hidden="true" />
                A próxima lista {KIND_LABELS[selectedList.kind].toLowerCase()} será
                criada sem preços e sem itens marcados.
              </p>
            )}
            {finishError && (
              <p className="shopping-confirm-error" role="alert">
                {finishError}
              </p>
            )}
            <div className="shopping-confirm-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setConfirmingFinish(false)
                  setFinishError('')
                }}
                disabled={finalizing}
              >
                Voltar à lista
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void finishList()}
                disabled={finalizing}
              >
                {finalizing ? 'Registrando...' : 'Finalizar agora'}
              </button>
            </div>
          </section>
        </div>
      )}

      {view === 'active' && (
        <>
          {showCreateForm && (
            <section
              ref={createPanelRef}
              className="panel shopping-create-panel"
              tabIndex={-1}
              aria-labelledby="shopping-create-title"
            >
              <div className="panel-head">
                <div>
                  <p className="section-label">Planejamento</p>
                  <h2 id="shopping-create-title">Nova compra ou gasto</h2>
                </div>
              </div>
              <form className="shopping-create-form" onSubmit={createList}>
                <label className="shopping-create-name">
                  Nome
                  <input
                    value={newListName}
                    onChange={event => setNewListName(event.target.value)}
                    placeholder="Ex: Compra mensal, Fraldas, Corte de cabelo"
                    maxLength={200}
                    required
                    disabled={saving}
                  />
                </label>
                <fieldset className="shopping-date-schedule">
                  <legend>Data planejada</legend>
                  <div className="shopping-date-options">
                    <label className={
                      newListDateChoice === 'today' ? 'is-selected' : ''
                    }>
                      <input
                        type="radio"
                        aria-label="Hoje"
                        name="shopping_date_choice"
                        value="today"
                        checked={newListDateChoice === 'today'}
                        onChange={() => setNewListDateChoice('today')}
                        disabled={saving}
                      />
                      <span>
                        <strong>Hoje</strong>
                        <small>{formatShortDate(localDateWithOffset(0))}</small>
                      </span>
                    </label>
                    <label className={
                      newListDateChoice === 'tomorrow' ? 'is-selected' : ''
                    }>
                      <input
                        type="radio"
                        aria-label="Amanhã"
                        name="shopping_date_choice"
                        value="tomorrow"
                        checked={newListDateChoice === 'tomorrow'}
                        onChange={() => setNewListDateChoice('tomorrow')}
                        disabled={saving}
                      />
                      <span>
                        <strong>Amanhã</strong>
                        <small>{formatShortDate(localDateWithOffset(1))}</small>
                      </span>
                    </label>
                    <label className={
                      newListDateChoice === 'other' ? 'is-selected' : ''
                    }>
                      <input
                        type="radio"
                        aria-label="Outra data"
                        name="shopping_date_choice"
                        value="other"
                        checked={newListDateChoice === 'other'}
                        onChange={() => setNewListDateChoice('other')}
                        disabled={saving}
                      />
                      <span>
                        <strong>Outra data</strong>
                        <small>Escolher</small>
                      </span>
                    </label>
                  </div>
                  {newListDateChoice === 'other' && (
                    <label className="shopping-custom-date">
                      Escolha a data
                      <input
                        type="date"
                        value={newListDate}
                        onChange={event => setNewListDate(event.target.value)}
                        min={localDateWithOffset(0)}
                        required
                        disabled={saving}
                      />
                    </label>
                  )}
                </fieldset>
                <label>
                  Tipo de compra
                  <select
                    value={newListKind}
                    onChange={event => {
                      const kind = event.target.value as ShoppingKind
                      setNewListKind(kind)
                      if (kind === 'one_time') setNewListRepeat(false)
                    }}
                    disabled={saving}
                  >
                    <option value="monthly">Mensal</option>
                    <option value="weekly">Semanal</option>
                    <option value="one_time">Avulsa</option>
                  </select>
                </label>
                <label>
                  Categoria
                  <select
                    value={newListCategory}
                    onChange={event =>
                      setNewListCategory(event.target.value as ShoppingCategory)
                    }
                    disabled={saving}
                  >
                    {CATEGORY_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Limite desta compra
                  <span className="shopping-money-field">
                    <span>R$</span>
                    <input
                      value={newListBudget}
                      onChange={event => setNewListBudget(event.target.value)}
                      inputMode="decimal"
                      placeholder="Opcional"
                      aria-label="Limite desta compra"
                      disabled={saving}
                    />
                  </span>
                </label>
                {newListKind !== 'one_time' && (
                  <label className="shopping-repeat-toggle">
                    <input
                      type="checkbox"
                      aria-label="Criar a próxima automaticamente"
                      checked={newListRepeat}
                      onChange={event => setNewListRepeat(event.target.checked)}
                      disabled={saving}
                    />
                    <span>
                      <strong>Criar a próxima automaticamente</strong>
                      <small>
                        Ao finalizar, itens e quantidades serão preparados na
                        próxima semana ou mês.
                      </small>
                    </span>
                  </label>
                )}
                <div className="shopping-form-actions">
                  <button className="primary-button" type="submit" disabled={saving}>
                    {saving ? 'Criando...' : 'Criar lista'}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </section>
          )}

          <section className="shopping-layout">
            <aside className="panel shopping-plans-panel">
              <div className="panel-head">
                <div>
                  <p className="section-label">Próximas</p>
                  <h2>Suas compras</h2>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => setShowCreateForm(true)}
                  aria-label="Criar nova compra"
                  disabled={hasPendingMutation}
                >
                  <Plus size={18} aria-hidden="true" />
                </button>
              </div>

              {lists.length === 0 ? (
                <div className="shopping-empty">
                  <ShoppingBasket size={25} aria-hidden="true" />
                  <strong>Nenhuma compra planejada</strong>
                  <span>Crie a primeira lista para organizar o próximo gasto.</span>
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(true)}
                    disabled={hasPendingMutation}
                  >
                    Criar lista
                  </button>
                </div>
              ) : (
                <div className="shopping-plan-list">
                  {lists.map(shoppingList => {
                    const checked = checkedItemCount(shoppingList)
                    return (
                      <article
                        key={shoppingList.id}
                        className={`shopping-plan-card ${selectedListId === shoppingList.id ? 'active' : ''}`}
                      >
                        <button
                          className="shopping-plan-select"
                          type="button"
                          onClick={() => setSelectedListId(shoppingList.id)}
                          disabled={hasPendingMutation}
                        >
                          <span className="shopping-plan-date">
                            <CalendarDays size={15} aria-hidden="true" />
                            {formatDate(shoppingList.planned_date)}
                          </span>
                          <strong>{shoppingList.name}</strong>
                          <small>
                            {CATEGORY_LABELS[shoppingList.category]} · {checked} de {shoppingList.items.length} itens
                          </small>
                          {shoppingList.budget_cents !== null && (
                            <small>
                              Limite {formatCurrency(shoppingList.budget_cents)}
                              {shoppingList.repeat_enabled ? ' · automática' : ''}
                            </small>
                          )}
                        </button>
                        <button
                          className="shopping-plan-delete"
                          type="button"
                          onClick={() => void deleteList(shoppingList)}
                          aria-label={`Excluir ${shoppingList.name}`}
                          disabled={hasPendingMutation}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </article>
                    )
                  })}
                </div>
              )}
            </aside>

            <section className="panel shopping-session-panel">
              {selectedList ? (
                <>
                  <header className="shopping-session-head">
                    <div>
                      <div className="shopping-session-chips">
                        <span className="shopping-kind-chip">{KIND_LABELS[selectedList.kind]}</span>
                        <span className="shopping-category-chip">
                          <Tags size={13} aria-hidden="true" />
                          {CATEGORY_LABELS[selectedList.category]}
                        </span>
                        {selectedList.repeat_enabled && (
                          <span className="shopping-repeat-chip">
                            <Repeat2 size={13} aria-hidden="true" />
                            Repete automaticamente
                          </span>
                        )}
                      </div>
                      <h2>{selectedList.name}</h2>
                      <p>
                        <CalendarDays size={15} aria-hidden="true" />
                        Planejada para {formatDate(selectedList.planned_date)}
                      </p>
                    </div>
                    <div className="shopping-session-progress">
                      <strong>{checkedItemCount(selectedList)}/{selectedList.items.length}</strong>
                      <span>itens pegos</span>
                    </div>
                  </header>

                  {selectedList.budget_cents !== null && (
                    <div className="shopping-list-budget">
                      <div>
                        <span>Gasto da lista</span>
                        <strong>{formatCurrency(listRunningTotal(selectedList))}</strong>
                      </div>
                      <div>
                        <span>Limite</span>
                        <strong>{formatCurrency(selectedList.budget_cents)}</strong>
                      </div>
                      <div className={
                        listRunningTotal(selectedList) > selectedList.budget_cents
                          ? 'is-negative'
                          : ''
                      }>
                        <span>Disponível</span>
                        <strong>
                          {formatCurrency(
                            selectedList.budget_cents
                            - listRunningTotal(selectedList),
                          )}
                        </strong>
                      </div>
                    </div>
                  )}

                  <form className="shopping-add-item" onSubmit={addItem}>
                    <label>
                      <span>Adicionar à lista</span>
                      <input
                        value={newItemName}
                        onChange={event => setNewItemName(event.target.value)}
                        placeholder="Ex: Arroz, leite, pacote de fraldas"
                        maxLength={200}
                        required
                        disabled={hasPendingMutation}
                      />
                    </label>
                    <label className="shopping-quantity-field">
                      <span>Quantidade</span>
                      <input
                        type="number"
                        min="1"
                        max="999"
                        step="1"
                        value={newItemQuantity}
                        onChange={event => setNewItemQuantity(event.target.value)}
                        aria-label="Quantidade do novo item"
                        required
                        disabled={hasPendingMutation}
                      />
                    </label>
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={hasPendingMutation}
                    >
                      <ListPlus size={17} aria-hidden="true" />
                      Adicionar
                    </button>
                  </form>

                  <div className="shopping-items" aria-live="polite">
                    {selectedList.items.length === 0 ? (
                      <div className="shopping-empty shopping-items-empty">
                        <Sparkles size={23} aria-hidden="true" />
                        <strong>Sua lista está vazia</strong>
                        <span>Adicione o que você precisa comprar.</span>
                      </div>
                    ) : (
                      selectedList.items.map(item => {
                        const checked = item.checked_at !== null
                        const enteringPrice = priceItemId === item.id
                        return (
                          <article
                            key={item.id}
                            className={`shopping-item ${checked ? 'is-checked' : ''}`}
                          >
                            <span className="shopping-item-check" aria-hidden="true">
                              {checked ? <Check size={18} /> : <ShoppingBasket size={17} />}
                            </span>
                            <div className="shopping-item-copy">
                              <strong>{item.name}</strong>
                              {checked ? (
                                <span>
                                  {item.quantity} × {formatCurrency(item.unit_price_cents || 0)}
                                  {' = '}
                                  {formatCurrency(item.price_cents || 0)}
                                </span>
                              ) : (
                                <span>
                                  {item.quantity} {item.quantity === 1 ? 'unidade' : 'unidades'}
                                  {' · ainda não pego'}
                                </span>
                              )}
                            </div>

                            {!enteringPrice && (
                              <div className="shopping-item-actions">
                                {checked ? (
                                  <>
                                    <button
                                      className="shopping-mini-action"
                                      type="button"
                                      onClick={() => startPriceEntry(item)}
                                      aria-label={`Editar preço de ${item.name}`}
                                      disabled={hasPendingMutation}
                                    >
                                      <Pencil size={15} aria-hidden="true" />
                                    </button>
                                    <button
                                      className="shopping-mini-action"
                                      type="button"
                                      onClick={() => void uncheckItem(item)}
                                      aria-label={`Desmarcar ${item.name}`}
                                      disabled={hasPendingMutation}
                                    >
                                      <RotateCcw size={15} aria-hidden="true" />
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    className="shopping-grab-button"
                                    type="button"
                                    onClick={() => startPriceEntry(item)}
                                    disabled={hasPendingMutation}
                                  >
                                    <Check size={16} aria-hidden="true" />
                                    Peguei
                                  </button>
                                )}
                                <button
                                  className="shopping-mini-action"
                                  type="button"
                                  onClick={() => void showPriceHistory(item)}
                                  aria-label={`Histórico de preço de ${item.name}`}
                                  disabled={priceHistoryLoading}
                                >
                                  <History size={15} aria-hidden="true" />
                                </button>
                                <button
                                  className="shopping-mini-action danger-button"
                                  type="button"
                                  onClick={() => void deleteItem(item)}
                                  aria-label={`Remover ${item.name}`}
                                  disabled={hasPendingMutation}
                                >
                                  <Trash2 size={15} aria-hidden="true" />
                                </button>
                              </div>
                            )}

                            {enteringPrice && (
                              <form
                                className="shopping-price-form"
                                onSubmit={event => void saveItemPrice(event, item)}
                              >
                                <label className="shopping-price-quantity">
                                  <span>Quantidade</span>
                                  <input
                                    type="number"
                                    min="1"
                                    max="999"
                                    step="1"
                                    value={priceQuantityDraft}
                                    onChange={event =>
                                      setPriceQuantityDraft(event.target.value)
                                    }
                                    aria-label={`Quantidade de ${item.name}`}
                                    required
                                    disabled={busyItemId === item.id}
                                  />
                                </label>
                                <label>
                                  <span>Preço por unidade</span>
                                  <div className="shopping-price-input">
                                    <span>R$</span>
                                    <input
                                      value={priceDraft}
                                      onChange={event => setPriceDraft(event.target.value)}
                                      inputMode="decimal"
                                      placeholder="0,00"
                                      aria-label={`Preço de ${item.name}`}
                                      required
                                      disabled={busyItemId === item.id}
                                    />
                                  </div>
                                </label>
                                <button
                                  className="primary-button"
                                  type="submit"
                                  disabled={busyItemId === item.id}
                                >
                                  Confirmar
                                </button>
                                <button
                                  className="ghost-button"
                                  type="button"
                                  onClick={() => {
                                    setPriceItemId(null)
                                    setPriceError('')
                                  }}
                                  disabled={busyItemId === item.id}
                                >
                                  Cancelar
                                </button>
                                {priceError && <small role="alert">{priceError}</small>}
                              </form>
                            )}
                          </article>
                        )
                      })
                    )}
                  </div>

                  {priceHistoryLoading && (
                    <div className="shopping-price-history" role="status">
                      <History size={18} aria-hidden="true" />
                      Consultando preços anteriores...
                    </div>
                  )}
                  {priceHistory && !priceHistoryLoading && (
                    <section className="shopping-price-history">
                      <header>
                        <div>
                          <span>Histórico de preço</span>
                          <strong>{priceHistory.item_name}</strong>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPriceHistory(null)}
                          aria-label="Fechar histórico de preço"
                        >
                          Fechar
                        </button>
                      </header>
                      {priceHistory.entries.length === 0 ? (
                        <p>Este será o primeiro preço registrado para este item.</p>
                      ) : (
                        <div>
                          {priceHistory.entries.map(entry => (
                            <article key={`${entry.item_id}-${entry.purchased_on}`}>
                              <span>
                                {formatDate(entry.purchased_on)}
                                {' · '}
                                {entry.list_name}
                              </span>
                              <strong>
                                {formatCurrency(entry.unit_price_cents)} por unidade
                              </strong>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  )}

                  <div className="shopping-total-bar">
                    <div>
                      <span>
                        {checkedItemCount(selectedList)} de {selectedList.items.length} itens
                      </span>
                      <strong>{formatCurrency(listRunningTotal(selectedList))}</strong>
                    </div>
                    <button
                      type="button"
                      onClick={requestFinish}
                      disabled={
                        hasPendingMutation
                        || priceItemId !== null
                        || checkedItemCount(selectedList) === 0
                      }
                    >
                      <CircleDollarSign size={19} aria-hidden="true" />
                      {finalizing ? 'Finalizando...' : 'Finalizar compra'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="shopping-empty shopping-session-empty">
                  <ShoppingBasket size={30} aria-hidden="true" />
                  <strong>Escolha ou crie uma compra</strong>
                  <span>A lista e o total aparecerão aqui.</span>
                </div>
              )}
            </section>
          </section>
        </>
      )}

      {view === 'history' && (
        <section className="shopping-history">
          <div className="panel shopping-history-head">
            <div>
              <p className="section-label">Controle financeiro</p>
              <h2>Histórico mensal</h2>
              <p>Somente compras finalizadas entram neste total.</p>
            </div>
            <div className="shopping-history-controls">
              <label>
                Mês
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={event => setSelectedMonth(event.target.value)}
                />
              </label>
              <button
                className="ghost-button"
                type="button"
                onClick={() => visibleHistory && exportMonthlyCsv(visibleHistory)}
                disabled={!visibleHistory || visibleHistory.lists.length === 0}
              >
                <Download size={16} aria-hidden="true" />
                Exportar CSV
              </button>
            </div>
          </div>

          <section className="panel shopping-budget-panel">
            <div>
              <span className="shopping-budget-icon" aria-hidden="true">
                <WalletCards size={20} />
              </span>
              <div>
                <p className="section-label">Orçamento mensal</p>
                <h3>Quanto você pode gastar em {formatMonth(selectedMonth)}?</h3>
                <p>Este valor vira seu planejado e calcula o saldo disponível.</p>
              </div>
            </div>
            <form onSubmit={saveMonthlyBudget}>
              <label>
                Limite do mês
                <span className="shopping-money-field">
                  <span>R$</span>
                  <input
                    value={budgetDraft}
                    onChange={event => setBudgetDraft(event.target.value)}
                    inputMode="decimal"
                    placeholder="Ex: 1.500,00"
                    aria-label={`Orçamento de ${formatMonth(selectedMonth)}`}
                    required
                    disabled={budgetSaving || historyLoading}
                  />
                </span>
              </label>
              <button
                className="primary-button"
                type="submit"
                disabled={budgetSaving || historyLoading}
              >
                <Save size={16} aria-hidden="true" />
                {budgetSaving ? 'Salvando...' : 'Salvar orçamento'}
              </button>
            </form>
          </section>

          <div className="shopping-history-summary">
            <article>
              <span>Planejado</span>
              <strong>
                {historyLoading || !visibleHistory
                  ? '—'
                  : formatCurrency(visibleHistory.planned_cents)}
              </strong>
            </article>
            <article>
              <span>Gasto</span>
              <strong>
                {historyLoading || !visibleHistory
                  ? '—'
                  : formatCurrency(visibleHistory.total_cents)}
              </strong>
            </article>
            <article className={
              visibleHistory && visibleHistory.balance_cents < 0
                ? 'is-negative'
                : 'is-positive'
            }>
              <span>Saldo do mês</span>
              <strong>
                {historyLoading || !visibleHistory
                  ? '—'
                  : formatCurrency(visibleHistory.balance_cents)}
              </strong>
            </article>
            <article>
              <span>Mês anterior</span>
              <strong>
                {historyLoading || !visibleHistory
                  ? '—'
                  : formatCurrency(visibleHistory.previous_month_total_cents)}
              </strong>
            </article>
            <article className={
              visibleHistory && visibleHistory.change_cents > 0
                ? 'is-negative'
                : 'is-positive'
            }>
              <span>Comparação</span>
              <strong>
                {historyLoading || !visibleHistory
                  ? '—'
                  : visibleHistory.change_percent === null
                    ? 'Sem base'
                    : `${Math.abs(visibleHistory.change_percent).toLocaleString('pt-BR')}%`}
              </strong>
              {visibleHistory && visibleHistory.change_percent !== null && (
                <small>
                  {visibleHistory.change_cents > 0
                    ? <TrendingUp size={14} aria-hidden="true" />
                    : <TrendingDown size={14} aria-hidden="true" />}
                  {visibleHistory.change_cents > 0 ? 'a mais' : 'a menos'}
                </small>
              )}
            </article>
          </div>

          {visibleHistory && visibleHistory.category_totals.length > 0 && (
            <section className="panel shopping-category-summary">
              <div>
                <p className="section-label">Por categoria</p>
                <h3>Onde o dinheiro foi usado</h3>
              </div>
              <div>
                {visibleHistory.category_totals.map(category => (
                  <article key={category.category}>
                    <span>{CATEGORY_LABELS[category.category]}</span>
                    <strong>{formatCurrency(category.total_cents)}</strong>
                  </article>
                ))}
              </div>
            </section>
          )}

          <div className="shopping-history-list">
            {historyLoading || !visibleHistory ? (
              <div className="panel shopping-empty" role="status">
                <ReceiptText size={27} aria-hidden="true" />
                <strong>Carregando histórico</strong>
                <span>Buscando os gastos de {formatMonth(selectedMonth)}.</span>
              </div>
            ) : visibleHistory.lists.length === 0 ? (
              <div className="panel shopping-empty">
                <ReceiptText size={27} aria-hidden="true" />
                <strong>Nenhum gasto em {formatMonth(selectedMonth)}</strong>
                <span>As compras finalizadas neste mês aparecerão aqui.</span>
              </div>
            ) : (
              visibleHistory.lists.map(shoppingList => (
                <details className="panel shopping-history-card" key={shoppingList.id}>
                  <summary>
                    <span className="shopping-history-icon" aria-hidden="true">
                      <ReceiptText size={19} />
                    </span>
                    <span>
                      <strong>{shoppingList.name}</strong>
                      <small>
                        {formatDate(shoppingList.completed_on || shoppingList.planned_date)}
                        {' · '}
                        {CATEGORY_LABELS[shoppingList.category]}
                      </small>
                    </span>
                    <strong>{formatCurrency(shoppingList.total_cents)}</strong>
                    <ChevronDown size={18} aria-hidden="true" />
                  </summary>
                  <div className="shopping-receipt">
                    {shoppingList.items.map(item => (
                      <div key={item.id} className={item.checked_at ? '' : 'skipped'}>
                        <span>
                          {item.name}
                          {item.checked_at && (
                            <small>
                              {item.quantity} × {formatCurrency(item.unit_price_cents || 0)}
                            </small>
                          )}
                        </span>
                        <strong>
                          {item.checked_at
                            ? formatCurrency(item.price_cents || 0)
                            : 'Não comprado'}
                        </strong>
                      </div>
                    ))}
                    <footer>
                      <span>Total pago</span>
                      <strong>{formatCurrency(shoppingList.total_cents)}</strong>
                    </footer>
                    <button
                      className="shopping-reopen-button"
                      type="button"
                      onClick={() => void reopenList(shoppingList)}
                      disabled={reopeningListId !== null}
                    >
                      <RotateCcw size={16} aria-hidden="true" />
                      {reopeningListId === shoppingList.id
                        ? 'Reabrindo...'
                        : 'Corrigir esta compra'}
                    </button>
                  </div>
                </details>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  )
}
