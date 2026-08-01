export interface ExerciseVideo {
  src: string
  cue: string
}

interface ExerciseVideoEntry extends ExerciseVideo {
  aliases: string[]
}

function normalizeExerciseName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const EXERCISE_VIDEOS: ExerciseVideoEntry[] = [
  {
    aliases: ['supino no chao com halteres', 'supino no chao'],
    src: '/exercise-videos/supino-chao.mp4',
    cue: 'Desça os halteres com controle e mantenha os cotovelos firmes.',
  },
  {
    aliases: ['crucifixo no chao', 'crucifixo com halteres'],
    src: '/exercise-videos/crucifixo-chao.mp4',
    cue: 'Mantenha uma leve flexão nos cotovelos durante todo o movimento.',
  },
  {
    aliases: ['triceps frances com halter', 'triceps frances'],
    src: '/exercise-videos/triceps-frances.mp4',
    cue: 'Mantenha os cotovelos apontados para a frente e mova apenas os antebraços.',
  },
  {
    aliases: ['agachamento goblet', 'agachamento com halter'],
    src: '/exercise-videos/agachamento-goblet.mp4',
    cue: 'Segure a carga perto do peito e mantenha os joelhos alinhados com os pés.',
  },
  {
    aliases: ['levantamento terra romeno', 'terra romeno com halteres'],
    src: '/exercise-videos/terra-romeno.mp4',
    cue: 'Leve o quadril para trás e preserve a coluna neutra.',
  },
  {
    aliases: ['panturrilha em pe', 'elevacao de panturrilha'],
    src: '/exercise-videos/panturrilha-pe.mp4',
    cue: 'Suba e desça devagar, usando toda a amplitude que conseguir controlar.',
  },
  {
    aliases: ['remada unilateral com halter', 'remada unilateral'],
    src: '/exercise-videos/remada-unilateral.mp4',
    cue: 'Apoie-se com firmeza e puxe o halter em direção ao quadril.',
  },
  {
    aliases: ['pullover no chao', 'pullover com halter'],
    src: '/exercise-videos/pullover-chao.mp4',
    cue: 'Mantenha o abdômen firme e faça o arco sem forçar os ombros.',
  },
  {
    aliases: ['rosca alternada', 'rosca alternada com halteres'],
    src: '/exercise-videos/rosca-alternada.mp4',
    cue: 'Evite balançar o tronco e mantenha os cotovelos junto ao corpo.',
  },
  {
    aliases: ['desenvolvimento com halteres', 'desenvolvimento de ombros'],
    src: '/exercise-videos/desenvolvimento-halteres.mp4',
    cue: 'Empurre os halteres para cima sem arquear a lombar.',
  },
  {
    aliases: ['elevacao lateral', 'elevacao lateral com halteres'],
    src: '/exercise-videos/elevacao-lateral.mp4',
    cue: 'Use uma carga controlável e pare os braços na altura dos ombros.',
  },
  {
    aliases: ['afundo alternado', 'afundo com halteres'],
    src: '/exercise-videos/afundo-alternado.mp4',
    cue: 'Dê um passo estável e mantenha o joelho alinhado com o pé.',
  },
  {
    aliases: ['caminhada do fazendeiro', 'farmer walk'],
    src: '/exercise-videos/caminhada-fazendeiro.mp4',
    cue: 'Caminhe ereto, com o abdômen firme e os halteres estáveis ao lado do corpo.',
  },
]

export function getExerciseVideo(exerciseName: string): ExerciseVideo | null {
  const key = normalizeExerciseName(exerciseName)
  if (!key) return null

  const entry = EXERCISE_VIDEOS.find(item => item.aliases.some(alias => (
    key === alias || key.includes(alias) || alias.includes(key)
  )))

  return entry ? { src: entry.src, cue: entry.cue } : null
}
