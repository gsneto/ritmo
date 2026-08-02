import { FormEvent, useEffect, useRef, useState } from 'react'
import { ArrowUp, MessageCircle, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { anahiApi } from '../services/anahiApi'
import './Anahi.css'

interface AnahiProps {
  userId: number
}

interface ConversationTurn {
  id: number
  question: string
  answer: string
  profileName: string
  asOf: string
  usedSources: string[]
}

const MAX_QUESTION_LENGTH = 500
const SUGGESTIONS = [
  'Qual livro estou mais perto de terminar?',
  'Quanto gastei nas compras do mês passado?',
  'O que ainda está pendente para hoje?',
]
const SOURCE_LABELS: Record<string, string> = {
  habits: 'hábitos',
  tasks: 'tarefas',
  reading: 'leitura',
  shopping: 'compras',
  workouts: 'treinos',
}

function formatContextDate(value: string): string {
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}

function formatSources(sources: string[]): string {
  if (sources.length === 0) return 'nenhuma área do app'
  return sources.map(source => SOURCE_LABELS[source] || source).join(', ')
}

export default function Anahi({ userId }: AnahiProps) {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<ConversationTurn[]>([])
  const [pendingQuestion, setPendingQuestion] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const nextId = useRef(1)
  const conversationEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (turns.length === 0 && !isLoading && !error) return
    const endMarker = conversationEnd.current
    if (endMarker && typeof endMarker.scrollIntoView === 'function') {
      endMarker.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [error, isLoading, turns])

  async function askAnahi(message: string) {
    const normalized = message.trim()
    if (!normalized || isLoading) return

    setError('')
    setQuestion('')
    setPendingQuestion(normalized)
    setIsLoading(true)

    try {
      const response = await anahiApi.ask(userId, normalized)
      setTurns(current => [
        ...current,
        {
          id: nextId.current++,
          question: normalized,
          answer: response.data.answer,
          profileName: response.data.profile_name,
          asOf: response.data.as_of,
          usedSources: response.data.used_sources,
        },
      ])
      setPendingQuestion('')
    } catch {
      setQuestion(normalized)
      setError('A ANAHÍ não está disponível neste servidor agora. Tente novamente em instantes.')
    } finally {
      setIsLoading(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void askAnahi(question)
  }

  function clearConversation() {
    setTurns([])
    setPendingQuestion('')
    setError('')
    setQuestion('')
  }

  return (
    <section className="view anahi-view" data-view="anahi">
      <header className="anahi-hero">
        <div className="anahi-hero-mark" aria-hidden="true">
          <Sparkles />
        </div>
        <div>
          <p className="section-label">Assistente do Ritmo</p>
          <h2>ANAHÍ</h2>
          <p>Sua guia para organizar ideias e seguir um passo de cada vez.</p>
        </div>
      </header>

      <section className="panel anahi-chat" aria-label="Conversa com a ANAHÍ">
        <div className="anahi-chat-head">
          <div className="anahi-presence" aria-label="ANAHÍ está online">
            <span className="anahi-online-dot" aria-hidden="true" />
            <span className="anahi-presence-copy">
              <strong>ANAHÍ</strong>
              <small>online agora</small>
            </span>
          </div>
          {turns.length > 0 && (
            <button
              className="anahi-clear-button"
              type="button"
              onClick={clearConversation}
            >
              <Trash2 aria-hidden="true" />
              Limpar desta tela
            </button>
          )}
        </div>

        <div className="anahi-conversation" aria-live="polite">
          <article className="anahi-message anahi-message-assistant">
            <span className="anahi-avatar" aria-hidden="true">
              <Sparkles />
            </span>
            <div>
              <strong>ANAHÍ</strong>
              <p>
                Olá! Agora posso consultar os dados do seu perfil sobre hábitos,
                tarefas, compras, leitura e treinos. O que você quer saber?
              </p>
            </div>
          </article>

          {turns.length === 0 && !isLoading && (
            <div className="anahi-suggestions" aria-label="Sugestões de perguntas">
              {SUGGESTIONS.map(suggestion => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void askAnahi(suggestion)}
                >
                  <MessageCircle aria-hidden="true" />
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {turns.map(turn => (
            <div className="anahi-turn" key={turn.id}>
              <article className="anahi-message anahi-message-user">
                <div>
                  <strong>Você</strong>
                  <p>{turn.question}</p>
                </div>
              </article>
              <article
                className="anahi-message anahi-message-assistant"
                role="region"
                aria-label="Resposta da ANAHÍ"
              >
                <span className="anahi-avatar" aria-hidden="true">
                  <Sparkles />
                </span>
                <div>
                  <strong>ANAHÍ</strong>
                  <p>{turn.answer}</p>
                  <small className="anahi-context-meta">
                    Dados usados: {formatSources(turn.usedSources)} · perfil {turn.profileName} · {formatContextDate(turn.asOf)}
                  </small>
                </div>
              </article>
            </div>
          ))}

          {isLoading && (
            <div className="anahi-thinking" role="status">
              <span /><span /><span />
              <p>ANAHÍ está pensando sobre “{pendingQuestion}”</p>
            </div>
          )}

          {error && <p className="anahi-error" role="alert">{error}</p>}
          <div ref={conversationEnd} />
        </div>

        <form className="anahi-composer" onSubmit={handleSubmit}>
          <label htmlFor="anahi-question">Pergunte à ANAHÍ</label>
          <div className="anahi-input-row">
            <textarea
              id="anahi-question"
              value={question}
              maxLength={MAX_QUESTION_LENGTH}
              rows={2}
              placeholder="Ex.: Como organizo meu dia de amanhã?"
              disabled={isLoading}
              onChange={event => setQuestion(event.target.value)}
            />
            <button
              type="submit"
              aria-label="Enviar pergunta"
              disabled={isLoading || question.trim().length === 0}
            >
              <ArrowUp aria-hidden="true" />
            </button>
          </div>
          <div className="anahi-composer-note">
            <span>
              <ShieldCheck aria-hidden="true" /> O Ritmo não salva este chat. Cada pergunta é processada pelo Google Gemini e, conforme o que você perguntar, pode enviar dados do perfil ativo sobre hábitos, tarefas, compras, treinos e leitura.
            </span>
            <span>{question.length}/{MAX_QUESTION_LENGTH}</span>
          </div>
        </form>
      </section>
    </section>
  )
}
