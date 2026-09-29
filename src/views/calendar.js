import { supabase } from '../supabaseClient.js'
import { fetchCheckinsRange, buildCompletionMap, isDayComplete, TASK_KEYS, toMadridDate } from '../game.js'

const TASK_INFO = {
  workout: { emoji: '💪', label: 'Entreno' },
  lunch: { emoji: '🍽️', label: 'Comida' },
  dinner: { emoji: '🌙', label: 'Cena' },
}

export async function renderCalendar(container, user, initialMonth) {
  const today = toMadridDate()
  let viewMonth = initialMonth || today.slice(0, 7) // 'YYYY-MM'

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, display_name')
    .order('created_at')

  if (profilesError) {
    container.innerHTML = `<p class="msg error">${profilesError.message}</p>`
    return
  }

  async function draw() {
    container.innerHTML = `<p class="muted">Cargando calendario…</p>`

    const [year, month] = viewMonth.split('-').map(Number)
    const firstDay = `${viewMonth}-01`
    const daysInMonth = new Date(year, month, 0).getDate()
    const lastDay = `${viewMonth}-${String(daysInMonth).padStart(2, '0')}`

    const checkins = await fetchCheckinsRange(firstDay, lastDay)
    const map = buildCompletionMap(checkins)

    const monthLabel = new Date(`${viewMonth}-01T00:00:00`).toLocaleDateString('es-ES', {
      month: 'long',
      year: 'numeric',
    })

    container.innerHTML = `
      <div class="cal-header">
        <button class="button ghost cal-nav" id="cal-prev">←</button>
        <h2>${capitalize(monthLabel)}</h2>
        <button class="button ghost cal-nav" id="cal-next">→</button>
      </div>
      <div class="cal-legend">
        ${profiles
          .map((p, i) => `<span class="cal-legend-item"><span class="dot dot-${i}"></span>${escapeHtml(p.display_name)}</span>`)
          .join('')}
      </div>
      <div class="cal-grid" id="cal-grid"></div>
      <div id="day-detail"></div>
    `

    const grid = container.querySelector('#cal-grid')

    // Huecos vacios antes del dia 1, para que la semana empiece en lunes
    const firstWeekday = (new Date(`${firstDay}T00:00:00`).getDay() + 6) % 7
    for (let i = 0; i < firstWeekday; i++) grid.appendChild(document.createElement('div'))

    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = `${viewMonth}-${String(d).padStart(2, '0')}`
      const cell = document.createElement('button')
      cell.type = 'button'
      cell.className = 'cal-day'

      let iconsHtml = ''
      if (dayStr > today) {
        cell.classList.add('cal-day-future')
      } else {
        iconsHtml = profiles
          .map((p, i) => {
            const done = isDayComplete(map, p.id, dayStr)
            if (dayStr === today && !done) return `<span class="cal-icon cal-pending dot-${i}">🕒</span>`
            return `<span class="cal-icon dot-${i}">${done ? '✓' : '✕'}</span>`
          })
          .join('')
      }

      if (dayStr === today) cell.classList.add('cal-day-today')
      cell.innerHTML = `<span class="cal-day-num">${d}</span><span class="cal-icons">${iconsHtml}</span>`

      if (dayStr <= today) {
        cell.addEventListener('click', () => showDayDetail(dayStr))
      } else {
        cell.disabled = true
      }
      grid.appendChild(cell)
    }

    container.querySelector('#cal-prev').addEventListener('click', () => {
      viewMonth = shiftMonth(viewMonth, -1)
      draw()
    })
    container.querySelector('#cal-next').addEventListener('click', () => {
      viewMonth = shiftMonth(viewMonth, 1)
      draw()
    })
  }

  async function showDayDetail(dayStr) {
    const detail = container.querySelector('#day-detail')
    detail.innerHTML = `<p class="muted">Cargando…</p>`

    const { data: rows, error } = await supabase.from('checkins').select('*').eq('day', dayStr)
    if (error) {
      detail.innerHTML = `<p class="msg error">${error.message}</p>`
      return
    }

    const byUserTask = {}
    for (const r of rows) byUserTask[`${r.user_id}|${r.task}`] = r

    detail.innerHTML = ''
    const heading = document.createElement('h3')
    heading.textContent = formatLongDate(dayStr)
    detail.appendChild(heading)

    for (const p of profiles) {
      const personBlock = document.createElement('div')
      personBlock.className = 'day-detail-person'
      personBlock.innerHTML = `<strong>${escapeHtml(p.display_name)}</strong>`
      detail.appendChild(personBlock)

      for (const t of TASK_KEYS) {
        const row = byUserTask[`${p.id}|${t}`]
        const info = TASK_INFO[t]
        const hasPhoto = !!row?.photo_path

        const taskBtn = document.createElement('button')
        taskBtn.type = 'button'
        taskBtn.className = 'day-detail-task'
        if (!hasPhoto) taskBtn.classList.add('day-detail-task-static')
        taskBtn.innerHTML = `
          <span>${info.emoji} ${info.label}</span>
          ${
            row
              ? `<span class="task-done">✓ ${formatTime(row.taken_at)}${hasPhoto ? ' <span class="chevron">▾</span>' : ''}</span>`
              : `<span class="task-pending">✕ No registrado</span>`
          }
        `
        detail.appendChild(taskBtn)

        if (hasPhoto) {
          const photoBox = document.createElement('div')
          photoBox.className = 'day-detail-photo-box'
          photoBox.hidden = true
          detail.appendChild(photoBox)

          let loaded = false
          taskBtn.addEventListener('click', async () => {
            const opening = photoBox.hidden
            photoBox.hidden = !opening
            taskBtn.classList.toggle('expanded', opening)

            if (opening && !loaded) {
              photoBox.innerHTML = `<p class="muted">Cargando foto…</p>`
              const { data } = await supabase.storage.from('checkin-photos').createSignedUrl(row.photo_path, 3600)
              if (data?.signedUrl) {
                photoBox.innerHTML = `<img class="task-photo" src="${data.signedUrl}" alt="${p.display_name} - ${info.label}" />`
                loaded = true
              } else {
                photoBox.innerHTML = `<p class="msg error">No se ha podido cargar la foto</p>`
              }
            }
          })
        }
      }
    }

    detail.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  await draw()
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatLongDate(iso) {
  const d = new Date(iso + 'T00:00:00')
  const text = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
