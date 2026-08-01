import { useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'

interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  [index: number]: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionEventLike {
  results: {
    [index: number]: SpeechRecognitionResultLike
  }
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

interface VoiceInputButtonProps {
  label: string
  onTranscript: (transcript: string) => void
  disabled?: boolean
}

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const speechWindow = window as SpeechWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

export default function VoiceInputButton({
  label,
  onTranscript,
  disabled = false,
}: VoiceInputButtonProps) {
  const Recognition = getSpeechRecognitionConstructor()
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const [listening, setListening] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => () => {
    recognitionRef.current?.abort()
    recognitionRef.current = null
  }, [])

  if (!Recognition) return null
  const RecognitionConstructor: SpeechRecognitionConstructor = Recognition

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }

    const recognition = new RecognitionConstructor()
    recognition.lang = 'pt-BR'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = event => {
      const transcript = event.results[0]?.[0]?.transcript.trim()
      if (transcript) {
        onTranscript(transcript)
        setMessage('Texto reconhecido. Revise antes de adicionar.')
      }
    }
    recognition.onerror = () => {
      setListening(false)
      setMessage('Não foi possível reconhecer a fala. Digite o texto normalmente.')
    }
    recognition.onend = () => {
      recognitionRef.current = null
      setListening(false)
    }
    recognitionRef.current = recognition
    setMessage('Ouvindo. Fale agora.')
    setListening(true)
    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      setListening(false)
      setMessage('Não foi possível iniciar o microfone. Digite o texto normalmente.')
    }
  }

  return (
    <>
      <button
        className={`voice-input-button${listening ? ' is-listening' : ''}`}
        type="button"
        onClick={toggleListening}
        disabled={disabled}
        aria-label={listening ? `Parar ditado de ${label}` : `Preencher ${label} por voz`}
        aria-pressed={listening}
        title={listening ? 'Parar ditado' : 'Preencher por voz'}
      >
        {listening
          ? <Square size={17} aria-hidden="true" />
          : <Mic size={19} aria-hidden="true" />}
      </button>
      <span className="visually-hidden" role="status" aria-live="polite">
        {message}
      </span>
    </>
  )
}
