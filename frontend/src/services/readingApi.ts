import { api } from './api'

export interface ReadingBook {
  id: number
  user_id: number
  title: string
  current_page: number
  total_pages: number
  notes: string
  progress_percent: number
  created_at: string
  updated_at: string
}

export interface ReadingBookInput {
  title: string
  current_page: number
  total_pages: number
  notes: string
}

export const readingApi = {
  getActiveBook: (userId: number) =>
    api.get<ReadingBook | null>(`/users/${userId}/reading-book`),
  saveActiveBook: (userId: number, data: ReadingBookInput) =>
    api.put<ReadingBook>(`/users/${userId}/reading-book`, data),
  deleteActiveBook: (userId: number) =>
    api.delete(`/users/${userId}/reading-book`),
}
