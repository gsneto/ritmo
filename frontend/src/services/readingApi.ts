import { api } from './api'

export type ReadingStatus = 'quero_ler' | 'lendo' | 'concluido'
export type ReadingSessionSource = 'manual' | 'focus'

export interface ReadingBook {
  id: number
  user_id: number
  title: string
  current_page: number
  total_pages: number
  notes: string
  status: ReadingStatus
  is_active: boolean
  progress_percent: number
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface ReadingBookInput {
  title: string
  current_page: number
  total_pages: number
  notes: string
}

export interface ReadingBookCreateInput extends ReadingBookInput {
  status: ReadingStatus
  is_active: boolean
}

export type ReadingBookUpdateInput = Partial<ReadingBookCreateInput>

export interface ReadingSession {
  id: number
  book_id: number
  book_title: string
  session_date: string
  start_page: number
  end_page: number
  pages_read: number
  duration_minutes: number
  source: ReadingSessionSource
  created_at: string
}

export interface ReadingSessionInput {
  session_date: string
  start_page: number
  end_page: number
  duration_minutes: number
  source: ReadingSessionSource
}

export interface ReadingNote {
  id: number
  book_id: number
  note_date: string
  page: number
  content: string
  created_at: string
  updated_at: string
}

export interface ReadingNoteInput {
  note_date: string
  page: number
  content: string
}

export interface ReadingWeek {
  week_start: string
  week_end: string
  pages_read: number
  duration_minutes: number
  session_count: number
}

export interface ReadingSummary {
  pages_this_week: number
  duration_this_week: number
  total_sessions: number
  recent_sessions: ReadingSession[]
  weeks: ReadingWeek[]
}

export const readingApi = {
  // Original routes remain available to old clients.
  getActiveBook: (userId: number) =>
    api.get<ReadingBook | null>(`/users/${userId}/reading-book`),
  saveActiveBook: (userId: number, data: ReadingBookInput) =>
    api.put<ReadingBook>(`/users/${userId}/reading-book`, data),
  deleteActiveBook: (userId: number) =>
    api.delete(`/users/${userId}/reading-book`),

  getBooks: (userId: number) =>
    api.get<ReadingBook[]>(`/users/${userId}/reading-books`),
  createBook: (userId: number, data: ReadingBookCreateInput) =>
    api.post<ReadingBook>(`/users/${userId}/reading-books`, data),
  updateBook: (bookId: number, data: ReadingBookUpdateInput) =>
    api.put<ReadingBook>(`/reading-books/${bookId}`, data),
  activateBook: (bookId: number) =>
    api.post<ReadingBook>(`/reading-books/${bookId}/activate`),
  deleteBook: (bookId: number) =>
    api.delete(`/reading-books/${bookId}`),

  getSessions: (userId: number, limit = 30) =>
    api.get<ReadingSession[]>(`/users/${userId}/reading-sessions`, {
      params: { limit },
    }),
  createSession: (bookId: number, data: ReadingSessionInput) =>
    api.post<ReadingSession>(`/reading-books/${bookId}/sessions`, data),
  deleteSession: (sessionId: number) =>
    api.delete(`/reading-sessions/${sessionId}`),

  getNotes: (bookId: number) =>
    api.get<ReadingNote[]>(`/reading-books/${bookId}/notes`),
  createNote: (bookId: number, data: ReadingNoteInput) =>
    api.post<ReadingNote>(`/reading-books/${bookId}/notes`, data),
  deleteNote: (noteId: number) =>
    api.delete(`/reading-notes/${noteId}`),

  getSummary: (userId: number, weeks = 8) =>
    api.get<ReadingSummary>(`/users/${userId}/reading-summary`, {
      params: { weeks },
    }),
}
