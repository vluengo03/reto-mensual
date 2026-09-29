import { supabase } from '../supabaseClient.js'
import { openCamera } from '../camera.js'
import {
  fetchAllCheckins,
  buildCompletionMap,
  isDayComplete,
  computeStreak,
  computeJointStreakParts,
  hasEverBeenJointComplete,
  computeMoneyOwed,
  petStage,
  toMadridDate,
  addDays,
} from '../game.js'

const TASKS = [
  { key: 'workout', label: 'Entreno', emoji: '💪' },
  { key: 'lunch', label: 'Comida', emoji: '🍽️' },
  { key: 'dinner', label: 'Cena', emoji: '🌙' },
]

export async function renderToday(container, user, onGoToProfile) {
  container.innerHTML = `<p class="muted">Cargando el día de hoy…</p>`

  const today = toMadridDate()

  const [{ data: profiles, error: profilesError }, checkinsAll, { data: todayRowsFull }, { data: lastMeasurements }] =
    await Promise.all([
      supabase.from('profiles').select('id, display_name').order('created_at'),
      fetchAllCheckins(),
      supabase.from('checkins').select('*').eq('user_id', user.id).eq('day', today),
      supabase
        .from('body_measurements')
        .select('measured_on')
        .eq('user_id', user.id)
        .order('measured_on', { ascending: false })
        .limit(1),
    ])

  if (profilesError) {
    container.innerHTML = `<p class="msg error">${profilesError.message}</p>`
    return
  }

  const map = buildCompletionMap(checkinsAll)

  container.innerHTML = `
    <h2>${formatDate(today)}</h2>
    ${renderMeasurementReminder(lastMeasurements?.[0], today)}
    ${renderGameHeader(profiles, map, today, user.id)}
    <div id="task-list"></div>
  `

  const reminderBtn = container.querySelector('#measurement-reminder-btn')
  if (reminderBtn) reminderBtn.addEventListener('click', () => onGoToProfile?.())

  const byTaskFull = Object.fromEntries((todayRowsFull ?? []).map((c) => [c.task, c]))

  const list = container.querySelector('#task-list')
  for (const task of TASKS) {
    const card = await buildTaskCard(task, byTaskFull[task.key], user, today)
    list.appendChild(card)
  }
}

function renderMeasurementReminder(last, today) {
  const daysSince = last ? Math.round((new Date(today) - new Date(last.measured_on)) / 86400000) : null
  const isStale = daysSince === null || daysSince >= 7
  if (!isStale) return ''

  const text = daysSince === null ? 'Aún no has registrado tus medidas.' : `Llevas ${daysSince} días sin actualizar tus medidas.`

  return `
    <div class="reminder-banner">
      <span>📏 ${text}</span>
      <button class="button ghost" id="measurement-reminder-btn">Actualizar</button>
    </div>
  `
}

function renderGameHeader(profiles, map, today, myId) {
  const partner = profiles.find((p) => p.id !== myId)
  const ids = profiles.map((p) => p.id)
  const yesterday = addDays(today, -1)

  const myStreak = computeStreak(map, myId, today)
  const partnerStreak = partner ? computeStreak(map, partner.id, today) : 0

  const monthStart = today.slice(0, 7) + '-01'
  const myMoney = computeMoneyOwed(map, myId, monthStart, yesterday)
  const partnerMoney = partner ? computeMoneyOwed(map, partner.id, monthStart, yesterday) : 0
  const net = partnerMoney - myMoney
  let moneyText
  if (net > 0) moneyText = `${escapeHtml(partner?.display_name ?? 'Tu compañero/a')} te debe ${net}€`
  else if (net < 0) moneyText = `Le debes ${Math.abs(net)}€ a ${escapeHtml(partner?.display_name ?? 'tu compañero/a')}`
  else moneyText = 'Estáis en paz este mes'

  const { pastStreak, todayComplete, age } = computeJointStreakParts(map, ids, today)
  const everHatched = hasEverBeenJointComplete(map, ids, yesterday)
  const stage = petStage(age)

  let petStatus = ''
  if (pastStreak === 0 && !todayComplete) {
    if (everHatched) {
      const culprits = profiles.filter((p) => !isDayComplete(map, p.id, yesterday)).map((p) => p.display_name)
      const who =
        culprits.length === profiles.length
          ? 'Fallasteis los dos ayer.'
          : `Fue por culpa de ${escapeHtml(culprits.join(' y '))} ayer.`
      petStatus = `<p class="pet-death">💀 La mascota murió. ${who}</p>`
    } else {
      petStatus = `<p class="muted">Completad los dos todas las tareas en el mismo día para que nazca.</p>`
    }
  } else if (pastStreak === 0 && todayComplete) {
    petStatus = everHatched
      ? `<p class="pet-born">🎉 Ha nacido un huevo nuevo hoy.</p>`
      : `<p class="pet-born">🎉 ¡Ha nacido vuestra primera mascota!</p>`
  }

  return `
    <section class="card game-header">
      <div class="pet-box">
        <span class="pet-emoji">${stage.emoji}</span>
        <div>
          <strong>${stage.label}</strong>
          <p class="muted">${age} día${age === 1 ? '' : 's'} juntos</p>
        </div>
      </div>
      ${petStatus}
      <div class="streak-row">
        <div class="streak-item">🔥 Tú: <strong>${myStreak}</strong></div>
        <div class="streak-item">🔥 ${escapeHtml(partner?.display_name ?? '—')}: <strong>${partnerStreak}</strong></div>
      </div>
      <p class="money-line">💶 ${moneyText}</p>
    </section>
  `
}

async function buildTaskCard(task, checkin, user, today) {
  const card = document.createElement('section')
  card.className = 'card task-card'

  async function captureAndUpload() {
    const blob = await openCamera()
    if (!blob) return null

    const path = `${user.id}/${today}/${task.key}.jpg`
    const { error: uploadError } = await supabase.storage
      .from('checkin-photos')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
    if (uploadError) {
      alert('No se ha podido subir la foto: ' + uploadError.message)
      return null
    }

    const { data: inserted, error: insertError } = await supabase
      .from('checkins')
      .insert({ user_id: user.id, task: task.key, photo_path: path })
      .select()
      .single()
    if (insertError) {
      alert('No se ha podido guardar: ' + insertError.message)
      return null
    }

    return inserted
  }

  if (checkin) {
    card.classList.add('task-done-card')

    let photoUrl = null
    if (checkin.photo_path) {
      const { data } = await supabase.storage.from('checkin-photos').createSignedUrl(checkin.photo_path, 3600)
      photoUrl = data?.signedUrl ?? null
    }
    const time = new Date(checkin.taken_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })

    card.innerHTML = `
      <div class="task-header">
        <span>${task.emoji} ${task.label}</span>
        <span class="task-done">✓ ${time}</span>
      </div>
      ${photoUrl ? `<img class="task-photo" src="${photoUrl}" alt="${task.label}" />` : ''}
      <div class="task-actions">
        <button class="button ghost retry-btn">↺ Repetir foto</button>
        <button class="button ghost delete-btn">🗑 Eliminar</button>
      </div>
    `

    card.querySelector('.retry-btn').addEventListener('click', async () => {
      if (!confirm('¿Repetir esta foto? Se borrará la actual y se abrirá la cámara.')) return
      const { error } = await supabase.from('checkins').delete().eq('id', checkin.id)
      if (error) {
        alert('No se ha podido borrar: ' + error.message)
        return
      }
      const inserted = await captureAndUpload()
      const freshCard = await buildTaskCard(task, inserted, user, today)
      card.replaceWith(freshCard)
    })

    card.querySelector('.delete-btn').addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta foto? La tarea volverá a quedar pendiente.')) return
      const { error } = await supabase.from('checkins').delete().eq('id', checkin.id)
      if (error) {
        alert('No se ha podido borrar: ' + error.message)
        return
      }
      const freshCard = await buildTaskCard(task, null, user, today)
      card.replaceWith(freshCard)
    })
  } else {
    card.innerHTML = `
      <div class="task-header">
        <span>${task.emoji} ${task.label}</span>
        <span class="task-pending">🕒 Pendiente</span>
      </div>
      <button class="button primary camera-btn">Abrir cámara</button>
    `

    card.querySelector('.camera-btn').addEventListener('click', async () => {
      const inserted = await captureAndUpload()
      if (!inserted) return
      const freshCard = await buildTaskCard(task, inserted, user, today)
      card.replaceWith(freshCard)
    })
  }

  return card
}

function formatDate(isoDate) {
  const d = new Date(isoDate + 'T00:00:00')
  const text = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
