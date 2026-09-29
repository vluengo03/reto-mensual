import { supabase } from '../supabaseClient.js'
import { fetchCheckinsRange, buildCompletionMap, isJointComplete, petStage, toMadridDate, addDays, computeMoneyOwed } from '../game.js'

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function lastDayOfMonth(ym) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m, 0).getDate()
  return `${ym}-${String(d).padStart(2, '0')}`
}

// Racha conjunta (mascota) que termina exactamente en ese dia, sin mirar mas alla.
// Sirve tanto para "hoy" como para el ultimo dia de un mes ya pasado.
function jointStreakEndingOn(map, userIds, day) {
  let streak = 0
  let cursor = day
  while (isJointComplete(map, userIds, cursor)) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}

// onOpenMonth(ym) se llama cuando el usuario pulsa "Ver calendario de este mes"
export async function renderYear(container, user, onOpenMonth) {
  const today = toMadridDate()
  let viewYear = Number(today.slice(0, 4))

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, display_name')
    .order('created_at')

  if (profilesError) {
    container.innerHTML = `<p class="msg error">${profilesError.message}</p>`
    return
  }
  const userIds = profiles.map((p) => p.id)

  async function draw() {
    container.innerHTML = `<p class="muted">Cargando el año…</p>`

    const checkins = await fetchCheckinsRange(`${viewYear}-01-01`, `${viewYear}-12-31`)
    const map = buildCompletionMap(checkins)

    container.innerHTML = `
      <div class="cal-header">
        <button class="button ghost cal-nav" id="year-prev">←</button>
        <h2>${viewYear}</h2>
        <button class="button ghost cal-nav" id="year-next">→</button>
      </div>
      <div class="year-grid" id="year-grid"></div>
      <div id="month-summary"></div>
    `

    const grid = container.querySelector('#year-grid')

    for (let m = 1; m <= 12; m++) {
      const ym = `${viewYear}-${String(m).padStart(2, '0')}`
      const monthStart = `${ym}-01`
      const lastDay = lastDayOfMonth(ym)
      const isCurrentMonth = today.slice(0, 7) === ym
      const hasStarted = monthStart <= today

      const cell = document.createElement('button')
      cell.type = 'button'
      cell.className = 'year-month'

      if (!hasStarted) {
        cell.disabled = true
        cell.classList.add('year-month-future')
        cell.innerHTML = `<span class="year-month-label">${MONTH_NAMES[m - 1]}</span><span class="year-month-emoji">—</span>`
      } else {
        const anchorDay = isCurrentMonth ? today : lastDay
        const stage = petStage(jointStreakEndingOn(map, userIds, anchorDay))
        cell.innerHTML = `<span class="year-month-label">${MONTH_NAMES[m - 1]}</span><span class="year-month-emoji">${stage.emoji}</span>`
        if (isCurrentMonth) cell.classList.add('year-month-current')
        cell.addEventListener('click', () => showMonthSummary(ym, map, isCurrentMonth))
      }

      grid.appendChild(cell)
    }

    container.querySelector('#year-prev').addEventListener('click', () => {
      viewYear -= 1
      draw()
    })
    container.querySelector('#year-next').addEventListener('click', () => {
      viewYear += 1
      draw()
    })
  }

  function showMonthSummary(ym, map, isCurrentMonth) {
    const summary = container.querySelector('#month-summary')
    const monthStart = `${ym}-01`
    const lastDay = lastDayOfMonth(ym)
    const loopEnd = isCurrentMonth ? today : lastDay
    const moneyEnd = isCurrentMonth ? addDays(today, -1) : lastDay

    // Racha mas larga que alcanzo la mascota durante el mes
    let longest = 0
    let cursor = monthStart
    while (cursor <= loopEnd) {
      const streak = jointStreakEndingOn(map, userIds, cursor)
      if (streak > longest) longest = streak
      cursor = addDays(cursor, 1)
    }

    // Veces que murio: dias en que fallo justo despues de venir de una racha viva
    let timesDied = 0
    cursor = monthStart
    while (cursor <= loopEnd) {
      const prevAge = jointStreakEndingOn(map, userIds, addDays(cursor, -1))
      if (prevAge > 0 && !isJointComplete(map, userIds, cursor)) timesDied++
      cursor = addDays(cursor, 1)
    }

    const monthLabel = new Date(`${ym}-01T00:00:00`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })

    const moneyRows = profiles
      .map((p) => {
        const owed = computeMoneyOwed(map, p.id, monthStart, moneyEnd)
        return `<div class="day-detail-task"><span>${escapeHtml(p.display_name)}</span><span>${owed}€ en fallos</span></div>`
      })
      .join('')

    summary.innerHTML = `
      <div class="card month-summary-card">
        <h3>${capitalize(monthLabel)}</h3>
        <div class="day-detail-task"><span>Racha más larga de la mascota</span><span>${longest} día${longest === 1 ? '' : 's'}</span></div>
        <div class="day-detail-task"><span>Veces que murió</span><span>${timesDied}</span></div>
        ${moneyRows}
        <button class="button secondary" id="open-month-cal">Ver calendario de este mes</button>
      </div>
    `

    summary.querySelector('#open-month-cal').addEventListener('click', () => onOpenMonth(ym))
    summary.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  await draw()
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
