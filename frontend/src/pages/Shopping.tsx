import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  ListPlus,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  ShoppingBasket,
  Sparkles,
  Trash2,
  WalletCards,
} from 'lucide-react'
import { apiRoutes } from '../services/api'
import type {
  MonthlyExpenseSummary,
  ShoppingItem,
  ShoppingKind,
  ShoppingList,
} from '../services/api'
import { toLocalDateValue } from '../utils/date'


interface ShoppingProps {
  userId: number
}

type ShoppingView = 'active' | 'history'

const KIND_LABELS: Record<ShoppingKind, string> = {
  monthly: 'Mensal',
  weekly: 'Semanal',
  one_time: 'Avulsa',
}

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

function listRunningTotal(shoppingList: ShoppingList): number {
  return shoppingList.items.reduce(
    (total, item) => total + (item.checked_at ? item.price_cents || 0 : 0),
    0,
  )
}

function checkedItemCount(shoppingList: ShoppingList): number {
  return shoppingList.items.filter(item => item.checked_at).length
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
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [newListDate, setNewListDate] = useState(toLocalDateValue())
  const [newListKind, setNewListKind] = useState<ShoppingKind>('monthly')
  const [newItemName, setNewItemName] = useState('')
  const [priceItemId, setPriceItemId] = useState<number | null>(null)
  const [priceDraft, setPriceDraft] = useState('')
  const [priceError, setPriceError] = useState('')
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
    setShowCreateForm(false)
    setPriceItemId(null)
    setPriceDraft('')
    setPriceError('')
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
      setLists(activeResponse.data)
      setHistory(historyResponse.data)
      setCurrentMonthSummary(historyResponse.data)
      setSelectedListId(current =>
        activeResponse.data.some(item => item.id === current)
          ? current
          : activeResponse.data[0]?.id || null,
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
    setLists(response.data)
    setSelectedListId(current => {
      if (preferredId && response.data.some(item => item.id === preferredId)) {
        return preferredId
      }
      if (response.data.some(item => item.id === current)) return current
      return response.data[0]?.id || null
    })
  }

  async function loadHistory(month: string) {
    const requestId = ++historyRequestIdRef.current
    setHistoryLoading(true)
    setError('')
    try {
      const response = await apiRoutes.getShoppingHistory(userId, month)
      if (requestId !== historyRequestIdRef.current) return
      setHistory(response.data)
      if (month === currentMonth) {
        setCurrentMonthSummary(response.data)
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
    setLists(current => current.map(shoppingList => (
      shoppingList.id === updatedItem.shopping_list_id
        ? {
            ...shoppingList,
            items: shoppingList.items.map(item =>
              item.id === updatedItem.id ? updatedItem : item
            ),
          }
        : shoppingList
    )))
  }

  async function createList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newListName.trim()) return
    if (saving || itemOperationRef.current !== null || finalizing) return
    const submittedDate = new FormData(event.currentTarget).get('planned_date')
    const plannedDate =
      typeof submittedDate === 'string' && submittedDate
        ? submittedDate
        : newListDate

    setSaving(true)
    setError('')
    try {
      const response = await apiRoutes.createShoppingList(userId, {
        name: newListName.trim(),
        kind: newListKind,
        planned_date: plannedDate,
      })
      setLists(current => [...current, response.data].sort(
        (a, b) => a.planned_date.localeCompare(b.planned_date),
      ))
      setSelectedListId(response.data.id)
      setNewListName('')
      setShowCreateForm(false)
    } catch (createError) {
      console.error('Failed to create shopping list:', createError)
      setError('Não foi possível criar esta compra.')
    } finally {
      setSaving(false)
    }
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

    setSaving(true)
    setError('')
    try {
      const response = await apiRoutes.addShoppingItem(
        selectedList.id,
        newItemName.trim(),
      )
      setLists(current => current.map(shoppingList => (
        shoppingList.id === selectedList.id
          ? { ...shoppingList, items: [...shoppingList.items, response.data] }
          : shoppingList
      )))
      setNewItemName('')
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
      item.price_cents === null
        ? ''
        : (item.price_cents / 100).toFixed(2).replace('.', ','),
    )
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

    itemOperationRef.current = item.id
    setBusyItemId(item.id)
    setPriceError('')
    try {
      const response = await apiRoutes.checkShoppingItem(item.id, {
        checked: true,
        price_cents: priceCents,
      })
      updateItemInState(response.data)
      if (priceItemId === item.id) {
        setPriceItemId(null)
        setPriceDraft('')
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
      setLists(current => current.filter(item => item.id !== selectedList.id))
      setSelectedListId(current => {
        if (current !== selectedList.id) return current
        return lists.find(item => item.id !== selectedList.id)?.id || null
      })
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
  const hasPendingMutation =
    saving
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
            onClick={() => {
              setView('active')
              setShowCreateForm(true)
            }}
          >
            <Plus size={18} aria-hidden="true" />
            Nova compra
          </button>
        </div>
        <article className="shopping-month-total">
          <span className="shopping-month-icon" aria-hidden="true">
            <WalletCards size={23} />
          </span>
          <div>
            <small>Gastos em {formatMonth(currentMonth)}</small>
            <strong>{formatCurrency(monthTotal)}</strong>
            <span>
              {monthPurchaseCount} {monthPurchaseCount === 1 ? 'compra finalizada' : 'compras finalizadas'}
            </span>
          </div>
        </article>
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
            <section className="panel shopping-create-panel">
              <div className="panel-head">
                <div>
                  <p className="section-label">Planejamento</p>
                  <h2>Nova compra ou gasto</h2>
                </div>
              </div>
              <form className="shopping-create-form" onSubmit={createList}>
                <label>
                  Nome
                  <input
                    value={newListName}
                    onChange={event => setNewListName(event.target.value)}
                    placeholder="Ex: Compra mensal, Fraldas, Corte de cabelo"
                    maxLength={200}
                    required
                    autoFocus
                    disabled={saving}
                  />
                </label>
                <label>
                  Data planejada
                  <input
                    type="date"
                    name="planned_date"
                    value={newListDate}
                    onChange={event => setNewListDate(event.target.value)}
                    required
                    disabled={saving}
                  />
                </label>
                <label>
                  Tipo de compra
                  <select
                    value={newListKind}
                    onChange={event => setNewListKind(event.target.value as ShoppingKind)}
                    disabled={saving}
                  >
                    <option value="monthly">Mensal</option>
                    <option value="weekly">Semanal</option>
                    <option value="one_time">Avulsa</option>
                  </select>
                </label>
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
                            {KIND_LABELS[shoppingList.kind]} · {checked} de {shoppingList.items.length} itens
                          </small>
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
                      <span className="shopping-kind-chip">{KIND_LABELS[selectedList.kind]}</span>
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
                                <span>{formatCurrency(item.price_cents || 0)}</span>
                              ) : (
                                <span>Ainda não pego</span>
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
                                <label>
                                  <span>Preço pago</span>
                                  <div className="shopping-price-input">
                                    <span>R$</span>
                                    <input
                                      value={priceDraft}
                                      onChange={event => setPriceDraft(event.target.value)}
                                      inputMode="decimal"
                                      placeholder="0,00"
                                      aria-label={`Preço de ${item.name}`}
                                      autoFocus
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
            <label>
              Mês
              <input
                type="month"
                value={selectedMonth}
                onChange={event => setSelectedMonth(event.target.value)}
              />
            </label>
          </div>

          <div className="shopping-history-summary">
            <article>
              <span>Total do mês</span>
              <strong>
                {historyLoading || !visibleHistory
                  ? '—'
                  : formatCurrency(visibleHistory.total_cents)}
              </strong>
            </article>
            <article>
              <span>Compras</span>
              <strong>
                {historyLoading || !visibleHistory
                  ? '—'
                  : visibleHistory.purchase_count}
              </strong>
            </article>
            <article>
              <span>Média por compra</span>
              <strong>
                {historyLoading || !visibleHistory
                  ? '—'
                  : formatCurrency(visibleHistory.average_cents)}
              </strong>
            </article>
          </div>

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
                        {KIND_LABELS[shoppingList.kind]}
                      </small>
                    </span>
                    <strong>{formatCurrency(shoppingList.total_cents)}</strong>
                    <ChevronDown size={18} aria-hidden="true" />
                  </summary>
                  <div className="shopping-receipt">
                    {shoppingList.items.map(item => (
                      <div key={item.id} className={item.checked_at ? '' : 'skipped'}>
                        <span>{item.name}</span>
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
