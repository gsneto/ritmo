import type { ShoppingDateChoice } from '../hooks/useShoppingCreateForm'

interface ShoppingDateOptionsProps {
  choice: ShoppingDateChoice
  todayLabel: string
  tomorrowLabel: string
  customDate: string
  minimumDate: string
  disabled: boolean
  onChoiceChange: (choice: ShoppingDateChoice) => void
  onCustomDateChange: (date: string) => void
}

export default function ShoppingDateOptions({
  choice,
  todayLabel,
  tomorrowLabel,
  customDate,
  minimumDate,
  disabled,
  onChoiceChange,
  onCustomDateChange,
}: ShoppingDateOptionsProps) {
  return (
    <fieldset className="shopping-date-schedule">
      <legend>Data planejada</legend>
      <div className="shopping-date-options">
        <label className={choice === 'today' ? 'is-selected' : ''}>
          <input
            type="radio"
            aria-label="Hoje"
            name="shopping_date_choice"
            value="today"
            checked={choice === 'today'}
            onChange={() => onChoiceChange('today')}
            disabled={disabled}
          />
          <span><strong>Hoje</strong><small>{todayLabel}</small></span>
        </label>
        <label className={choice === 'tomorrow' ? 'is-selected' : ''}>
          <input
            type="radio"
            aria-label="Amanhã"
            name="shopping_date_choice"
            value="tomorrow"
            checked={choice === 'tomorrow'}
            onChange={() => onChoiceChange('tomorrow')}
            disabled={disabled}
          />
          <span><strong>Amanhã</strong><small>{tomorrowLabel}</small></span>
        </label>
        <label className={choice === 'other' ? 'is-selected' : ''}>
          <input
            type="radio"
            aria-label="Outra data"
            name="shopping_date_choice"
            value="other"
            checked={choice === 'other'}
            onChange={() => onChoiceChange('other')}
            disabled={disabled}
          />
          <span><strong>Outra data</strong><small>Escolher</small></span>
        </label>
      </div>
      {choice === 'other' && (
        <label className="shopping-custom-date">
          Escolha a data
          <input
            type="date"
            value={customDate}
            onChange={event => onCustomDateChange(event.target.value)}
            min={minimumDate}
            required
            disabled={disabled}
          />
        </label>
      )}
    </fieldset>
  )
}
