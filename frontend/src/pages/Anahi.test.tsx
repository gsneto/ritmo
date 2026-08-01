import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/anahiApi', () => ({
  anahiApi: {
    ask: vi.fn(),
  },
}))

import { anahiApi } from '../services/anahiApi'
import Anahi from './Anahi'

describe('ANAHÍ assistant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not autofocus the question field when the tab opens', () => {
    render(<Anahi userId={1} />)

    expect(document.activeElement).not.toBe(
      screen.getByRole('textbox', { name: 'Pergunte \u00e0 ANAH\u00cd' }),
    )
  })

  it('shows ANAHÍ as online instead of a generic conversation label', () => {
    render(<Anahi userId={1} />)

    expect(screen.getByLabelText('ANAHÍ está online')).toBeTruthy()
    expect(screen.getByText('online agora')).toBeTruthy()
    expect(screen.queryByText('Conversa simples')).toBeNull()
  })

  it('sends a question and shows ANAHÍ response', async () => {
    vi.mocked(anahiApi.ask).mockResolvedValue({
      data: {
        answer: 'Comece pelo h\u00e1bito mais leve que voc\u00ea consegue repetir hoje.',
        profile_name: 'Antonio',
        as_of: '2026-07-31',
        used_sources: ['habits', 'tasks'],
      },
    } as never)

    render(<Anahi userId={1} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Pergunte \u00e0 ANAH\u00cd' }), {
      target: { value: 'Como retomar minha rotina?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pergunta' }))

    await waitFor(() => {
      expect(anahiApi.ask).toHaveBeenCalledWith(1, 'Como retomar minha rotina?')
    })
    expect(
      (await screen.findByRole('region', { name: 'Resposta da ANAHÍ' })).textContent,
    ).toContain('Comece pelo h\u00e1bito mais leve que voc\u00ea consegue repetir hoje.')
    expect(screen.getByText(
      /Dados usados: h\u00e1bitos, tarefas · perfil Antonio · 31\/07\/2026/,
    )).toBeTruthy()
  })

  it('shows a loading state while the answer is being prepared', async () => {
    let resolveAnswer: (value: { data: {
      answer: string
      profile_name: string
      as_of: string
      used_sources: string[]
    } }) => void = () => undefined
    const pendingAnswer = new Promise<{ data: {
      answer: string
      profile_name: string
      as_of: string
      used_sources: string[]
    } }>(resolve => {
      resolveAnswer = resolve
    })
    vi.mocked(anahiApi.ask).mockReturnValueOnce(pendingAnswer as never)

    render(<Anahi userId={1} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Pergunte \u00e0 ANAH\u00cd' }), {
      target: { value: 'O que merece minha aten\u00e7\u00e3o agora?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pergunta' }))

    expect((await screen.findByRole('status')).textContent).toContain('ANAHÍ est\u00e1 pensando')
    expect(screen.getByRole('button', { name: 'Enviar pergunta' }).hasAttribute('disabled')).toBe(true)

    await act(async () => {
      resolveAnswer({
        data: {
          answer: 'Escolha uma pequena pr\u00f3xima a\u00e7\u00e3o.',
          profile_name: 'Antonio',
          as_of: '2026-07-31',
          used_sources: ['habits', 'tasks'],
        },
      })
    })

    expect(await screen.findByText('Escolha uma pequena pr\u00f3xima a\u00e7\u00e3o.')).toBeTruthy()
  })

  it('explains when a simple answer did not use an app area', async () => {
    vi.mocked(anahiApi.ask).mockResolvedValue({
      data: {
        answer: 'Olá! Como posso ajudar?',
        profile_name: 'Antonio',
        as_of: '2026-07-31',
        used_sources: [],
      },
    } as never)

    render(<Anahi userId={1} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Pergunte à ANAHÍ' }), {
      target: { value: 'Oi' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pergunta' }))

    expect(await screen.findByText(
      /Dados usados: nenhuma área do app · perfil Antonio · 31\/07\/2026/,
    )).toBeTruthy()
  })

  it('shows a clear error when ANAHÍ cannot answer', async () => {
    vi.mocked(anahiApi.ask).mockRejectedValueOnce(new Error('offline'))

    render(<Anahi userId={1} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Pergunte \u00e0 ANAH\u00cd' }), {
      target: { value: 'Me ajude a planejar amanh\u00e3.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pergunta' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'A ANAH\u00cd n\u00e3o est\u00e1 dispon\u00edvel neste servidor agora. Tente novamente em instantes.',
    )
  })

  it('offers questions about profile data and explains what is sent', () => {
    render(<Anahi userId={1} />)

    expect(screen.getByRole('button', {
      name: 'Qual livro estou mais perto de terminar?',
    })).toBeTruthy()
    expect(screen.getByRole('button', {
      name: 'Quanto gastei nas compras do m\u00eas passado?',
    })).toBeTruthy()
    expect(screen.getByText(
      /sua pergunta e apenas os dados relacionados do perfil ativo s\u00e3o processados pela IA/,
    )).toBeTruthy()
  })
})
