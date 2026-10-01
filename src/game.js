import { supabase } from './supabaseClient.js'

export const TASK_KEYS = ['workout', 'lunch', 'dinner']

// "Hoy" siempre en hora de Madrid, para que coincida con la fecha
// que el servidor pone en cada check.
export function toMadridDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(date)
}

export function addDays(isoDate, delta) {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

// Todos los checkins de los dos usuarios, sin filtrar por fecha.
// Con solo 2 personas el volumen de datos es pequeño, asi que traer
// el historial completo es lo mas simple y no supone un problema.
export async function fetchAllCheckins() {
  const { data, error } = await supabase.from('checkins').select('user_id, day, task')
  if (error) throw error
  return data
}

// Solo los checkins entre dos fechas (para no traer de mas en el calendario mensual).
export async function fetchCheckinsRange(fromDate, toDate) {
  const { data, error } = await supabase.from('checkins').select('user_id, day, task').gte('day', fromDate).lte('day', toDate)
  if (error) throw error
  return data
}

// Convierte la lista de checkins en un mapa rapido de consultar:
// 'userId|2026-09-29' -> Set('workout', 'lunch')
export function buildCompletionMap(checkins) {
  const map = new Map()
  for (const c of checkins) {
    const key = `${c.user_id}|${c.day}`
    if (!map.has(key)) map.set(key, new Set())
    map.get(key).add(c.task)
  }
  return map
}

export function isDayComplete(map, userId, day) {
  const tasks = map.get(`${userId}|${day}`)
  return !!tasks && TASK_KEYS.every((t) => tasks.has(t))
}

export function isJointComplete(map, userIds, day) {
  return userIds.every((id) => isDayComplete(map, id, day))
}

// Racha individual: cuenta dias consecutivos completos terminando ayer,
// y suma hoy solo si ya esta completo (si no, el dia sigue "en curso"
// y no rompe la racha todavia).
export function computeStreak(map, userId, today) {
  let streak = 0
  let cursor = addDays(today, -1)
  while (isDayComplete(map, userId, cursor)) {
    streak++
    cursor = addDays(cursor, -1)
  }
  if (isDayComplete(map, userId, today)) streak++
  return streak
}

// Igual que computeStreak, pero exige que AMBOS usuarios cumplieran ese dia.
// Devuelve la racha de dias anteriores a hoy por separado, porque hace
// falta para saber si la mascota "murio" ayer.
export function computeJointStreakParts(map, userIds, today) {
  let pastStreak = 0
  let cursor = addDays(today, -1)
  while (isJointComplete(map, userIds, cursor)) {
    pastStreak++
    cursor = addDays(cursor, -1)
  }
  const todayComplete = isJointComplete(map, userIds, today)
  return { pastStreak, todayComplete, age: pastStreak + (todayComplete ? 1 : 0) }
}

// ¿Ha habido alguna vez, antes de esta fecha, un dia en que los dos cumplieran?
// Sirve para distinguir "la mascota murio" de "todavia no ha nacido".
export function hasEverBeenJointComplete(map, userIds, beforeOrEqualDate) {
  const days = new Set()
  for (const key of map.keys()) {
    const day = key.split('|')[1]
    if (day <= beforeOrEqualDate) days.add(day)
  }
  for (const day of days) {
    if (isJointComplete(map, userIds, day)) return true
  }
  return false
}

const PET_STAGES = [
  { key: 'huevo', emoji: '🥚', label: 'Huevo', min: 0, max: 1 },
  { key: 'cria', emoji: '🐣', label: 'Cría', min: 2, max: 6 },
  { key: 'joven', emoji: '🦎', label: 'Joven', min: 7, max: 13 },
  { key: 'adulto', emoji: '🐉', label: 'Adulto', min: 14, max: 29 },
  { key: 'final', emoji: '🌟', label: 'Forma final', min: 30, max: Infinity },
]

export function petStage(age) {
  return PET_STAGES.find((s) => age >= s.min && age <= s.max) ?? PET_STAGES[PET_STAGES.length - 1]
}

// Progreso dentro de la etapa actual: cuantos dias lleva y cuantos faltan
// para la siguiente. Sirve para pintar la barra de progreso.
export function petProgress(age) {
  const idx = PET_STAGES.findIndex((s) => age >= s.min && age <= s.max)
  const stage = PET_STAGES[idx]
  const next = PET_STAGES[idx + 1]

  if (!next) {
    return { stage, progressPct: 100, daysIntoStage: age - stage.min, stageLength: null, next: null }
  }

  const stageLength = stage.max - stage.min + 1
  const daysIntoStage = age - stage.min
  const progressPct = Math.round((daysIntoStage / stageLength) * 100)
  return { stage, progressPct, daysIntoStage, stageLength, next }
}

// Dinero acumulado por un usuario entre dos fechas YA TERMINADAS
// (nunca se debe incluir el dia de hoy, porque todavia puede cumplirse).
export function computeMoneyOwed(map, userId, fromDate, toDate, eurosPerFail = 5) {
  if (fromDate > toDate) return 0
  let total = 0
  let cursor = fromDate
  while (cursor <= toDate) {
    const tasks = map.get(`${userId}|${cursor}`) ?? new Set()
    for (const t of TASK_KEYS) {
      if (!tasks.has(t)) total += eurosPerFail
    }
    cursor = addDays(cursor, 1)
  }
  return total
}
