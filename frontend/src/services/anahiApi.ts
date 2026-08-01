import { api } from './api'

export interface AnahiAnswer {
  answer: string
  model: string
  profile_name: string
  as_of: string
  used_sources: Array<'habits' | 'tasks' | 'reading' | 'shopping' | 'workouts'>
}

export const anahiApi = {
  ask: (userId: number, message: string) =>
    api.post<AnahiAnswer>(`/users/${userId}/anahi/ask`, { question: message }),
}
