import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRoutes } from '../services/api'
import Progress from './Progress'

vi.mock('../services/api', () => ({
  apiRoutes: {
    getMonthStats: vi.fn(),
    getWeekStats: vi.fn(),
    getStreak: vi.fn(),
    getHabits: vi.fn(),
    getInsights: vi.fn(),
  },
}))

describe('Progress cross-domain insights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiRoutes.getMonthStats).mockResolvedValue({
      data: { months: [{ month: 'Ago', score: 80 }] },
    } as never)
    vi.mocked(apiRoutes.getWeekStats).mockResolvedValue({ data: { days: [] } } as never)
    vi.mocked(apiRoutes.getStreak).mockResolvedValue({ data: { streak: 5 } } as never)
    vi.mocked(apiRoutes.getHabits).mockResolvedValue({ data: [] } as never)
    vi.mocked(apiRoutes.getInsights).mockResolvedValue({
      data: { history_days: 0, minimum_history_days: 14, insights: [] },
    } as never)
  })

  it('shows deterministic insights returned by the API', async () => {
    vi.mocked(apiRoutes.getInsights).mockResolvedValue({
      data: {
        history_days: 28,
        minimum_history_days: 14,
        insights: [{
          key: 'habit_training_days',
          title: 'Treino e hábitos',
          description: 'Sua conclusão foi maior nos dias com treino. É uma associação, não uma relação de causa.',
          sample_size: 28,
        }],
      },
    } as never)

    render(<Progress userId={1} />)

    expect(await screen.findByText('Treino e hábitos')).toBeTruthy()
    expect(screen.getByText(/associação, não uma relação de causa/)).toBeTruthy()
  })

  it('hides the insights section until enough history exists', async () => {
    vi.mocked(apiRoutes.getInsights).mockResolvedValue({
      data: { history_days: 5, minimum_history_days: 14, insights: [] },
    } as never)

    render(<Progress userId={1} />)

    await waitFor(() => expect(apiRoutes.getInsights).toHaveBeenCalledWith(1))
    expect(screen.queryByText('Conexões do seu ritmo')).toBeNull()
  })

  it('defines the progress metrics with an accessible glossary', async () => {
    render(<Progress userId={1} />)

    expect(await screen.findByRole('heading', { name: 'Glossário' })).toBeTruthy()
    expect(screen.getByText(
      'Percentual de check-ins concluídos em relação aos hábitos planejados no período.',
    )).toBeTruthy()
    expect(screen.getByText(
      'Dias seguidos com todos os hábitos planejados concluídos. Dias sem hábitos planejados são ignorados.',
    )).toBeTruthy()
    expect(screen.getByText(
      'Total de check-ins registrados em todo o histórico.',
    )).toBeTruthy()
  })

  it('shows a loading state instead of zero metrics', () => {
    vi.mocked(apiRoutes.getMonthStats).mockReturnValue(new Promise(() => undefined) as never)

    render(<Progress userId={1} />)

    expect(screen.getByRole('status').textContent).toContain('Carregando seu progresso')
    expect(screen.queryByText('Consistência do mês')).toBeNull()
  })

  it('shows an error and retries without presenting the failure as zero', async () => {
    vi.mocked(apiRoutes.getInsights)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        data: { history_days: 0, minimum_history_days: 14, insights: [] },
      } as never)

    render(<Progress userId={1} />)

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível carregar seu progresso',
    )
    expect(screen.queryByText('Consistência do mês')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    await waitFor(() => expect(apiRoutes.getInsights).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Consistência do mês')).toBeTruthy()
  })
})
