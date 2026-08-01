import { useState } from 'react'
import type { ShoppingCategory, ShoppingKind } from '../services/api'
import { toLocalDateValue } from '../utils/date'

export type ShoppingDateChoice = 'today' | 'tomorrow' | 'other'

export function useShoppingCreateForm() {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createFormRevealRequest, setCreateFormRevealRequest] = useState(0)
  const [newListName, setNewListName] = useState('')
  const [newListDate, setNewListDate] = useState(toLocalDateValue())
  const [newListDateChoice, setNewListDateChoice] =
    useState<ShoppingDateChoice>('today')
  const [newListKind, setNewListKind] = useState<ShoppingKind>('monthly')
  const [newListCategory, setNewListCategory] =
    useState<ShoppingCategory>('groceries')
  const [newListBudget, setNewListBudget] = useState('')
  const [newListRepeat, setNewListRepeat] = useState(true)
  const [newItemName, setNewItemName] = useState('')
  const [newItemQuantity, setNewItemQuantity] = useState('1')

  function reset() {
    setShowCreateForm(false)
    setCreateFormRevealRequest(0)
    setNewListName('')
    setNewListDate(toLocalDateValue())
    setNewListDateChoice('today')
    setNewListKind('monthly')
    setNewListCategory('groceries')
    setNewListBudget('')
    setNewListRepeat(true)
    setNewItemName('')
    setNewItemQuantity('1')
  }

  return {
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
    reset,
  }
}
