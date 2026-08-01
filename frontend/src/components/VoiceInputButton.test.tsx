import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VoiceInputButton from './VoiceInputButton'

interface MockSpeechWindow extends Window {
  SpeechRecognition?: typeof MockSpeechRecognition
  webkitSpeechRecognition?: typeof MockSpeechRecognition
}

class MockSpeechRecognition {
  static latest: MockSpeechRecognition | null = null

  lang = ''
  continuous = true
  interimResults = true
  maxAlternatives = 0
  onresult: ((event: { results: Array<Array<{ transcript: string }>> }) => void) | null = null
  onerror: (() => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()

  constructor() {
    MockSpeechRecognition.latest = this
  }
}

function speechWindow(): MockSpeechWindow {
  return window as MockSpeechWindow
}

afterEach(() => {
  delete speechWindow().SpeechRecognition
  delete speechWindow().webkitSpeechRecognition
  MockSpeechRecognition.latest = null
})

describe('VoiceInputButton', () => {
  it('does not render when the browser has no speech recognition API', () => {
    render(<VoiceInputButton label="nome da tarefa" onTranscript={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /por voz/ })).toBeNull()
  })

  it('transcribes Brazilian Portuguese without submitting anything', () => {
    speechWindow().webkitSpeechRecognition = MockSpeechRecognition
    const onTranscript = vi.fn()

    render(<VoiceInputButton label="nome da tarefa" onTranscript={onTranscript} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preencher nome da tarefa por voz' }))

    const recognition = MockSpeechRecognition.latest
    expect(recognition).toBeTruthy()
    expect(recognition?.lang).toBe('pt-BR')
    expect(recognition?.continuous).toBe(false)
    expect(recognition?.interimResults).toBe(false)
    expect(recognition?.start).toHaveBeenCalledOnce()

    act(() => {
      recognition?.onresult?.({ results: [[{ transcript: 'Comprar café' }]] })
      recognition?.onend?.()
    })

    expect(onTranscript).toHaveBeenCalledWith('Comprar café')
    expect(screen.getByRole('button', { name: 'Preencher nome da tarefa por voz' })).toBeTruthy()
  })
})
