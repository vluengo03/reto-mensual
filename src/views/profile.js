import { supabase } from '../supabaseClient.js'

export async function renderProfile(container, user) {
  container.innerHTML = `<p class="muted">Cargando perfil…</p>`

  const [{ data: profile, error: profileError }, { data: measurements }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase
      .from('body_measurements')
      .select('*')
      .eq('user_id', user.id)
      .order('measured_on', { ascending: false })
      .limit(1),
  ])

  if (profileError) {
    container.innerHTML = `<p class="msg error">No se ha podido cargar el perfil: ${profileError.message}</p>`
    return
  }

  const last = measurements?.[0] ?? {}
  const today = new Date().toISOString().slice(0, 10)

  let avatarUrl = placeholderAvatar()
  if (profile.avatar_path) {
    const { data } = await supabase.storage.from('avatars').createSignedUrl(profile.avatar_path, 3600)
    if (data?.signedUrl) avatarUrl = data.signedUrl
  }

  container.innerHTML = `
    <section class="card">
      <h2>Tu perfil</h2>
      <div class="avatar-row">
        <img id="avatar-preview" class="avatar" src="${avatarUrl}" alt="Foto de perfil" />
        <div>
          <label class="button secondary" for="avatar-input">Cambiar foto</label>
          <input id="avatar-input" type="file" accept="image/*" capture="environment" hidden />
        </div>
      </div>

      <form id="profile-form">
        <label>Nombre visible
          <input type="text" name="display_name" value="${escapeHtml(profile.display_name ?? '')}" required maxlength="30" />
        </label>
        <label>Edad
          <input type="number" name="age" value="${profile.age ?? ''}" min="10" max="120" />
        </label>
        <label>Género
          <select name="gender">
            <option value="">Prefiero no decirlo</option>
            <option value="hombre" ${profile.gender === 'hombre' ? 'selected' : ''}>Hombre</option>
            <option value="mujer" ${profile.gender === 'mujer' ? 'selected' : ''}>Mujer</option>
            <option value="otro" ${profile.gender === 'otro' ? 'selected' : ''}>Otro</option>
          </select>
        </label>
        <label>Altura (cm)
          <input type="number" name="height_cm" value="${profile.height_cm ?? ''}" step="0.1" min="100" max="250" />
        </label>
        <button type="submit" class="button primary">Guardar perfil</button>
        <p id="profile-msg" class="msg"></p>
      </form>
    </section>

    <section class="card">
      <h2>Medidas de hoy</h2>
      <p class="muted">Última medida guardada: ${last.measured_on ?? 'ninguna todavía'}</p>
      <form id="measurements-form">
        <label>Peso (kg)
          <input type="number" name="weight_kg" value="${last.weight_kg ?? ''}" step="0.1" min="30" max="300" />
        </label>
        <label>% Grasa corporal
          <input type="number" name="body_fat_pct" value="${last.body_fat_pct ?? ''}" step="0.1" min="1" max="70" />
        </label>
        <label>% Músculo
          <input type="number" name="muscle_pct" value="${last.muscle_pct ?? ''}" step="0.1" min="1" max="90" />
        </label>
        <button type="submit" class="button primary">Guardar medidas de hoy</button>
        <p id="measurements-msg" class="msg"></p>
      </form>
    </section>

    <section class="card">
      <h2>Contraseña</h2>
      <form id="password-form">
        <label>Nueva contraseña
          <input type="password" name="password" minlength="8" required />
        </label>
        <label>Repite la contraseña
          <input type="password" name="password2" minlength="8" required />
        </label>
        <button type="submit" class="button secondary">Cambiar contraseña</button>
        <p id="password-msg" class="msg"></p>
      </form>
    </section>

    <button id="logout-btn" class="button ghost">Cerrar sesión</button>
  `

  // --- Foto de perfil ---
  container.querySelector('#avatar-input').addEventListener('change', async (e) => {
    const file = e.target.files[0]
    if (!file) return

    const path = `${user.id}/avatar.jpg`
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type })

    if (uploadError) {
      alert('No se ha podido subir la foto: ' + uploadError.message)
      return
    }

    await supabase.from('profiles').update({ avatar_path: path }).eq('id', user.id)
    const { data } = await supabase.storage.from('avatars').createSignedUrl(path, 3600)
    if (data?.signedUrl) {
      container.querySelector('#avatar-preview').src = data.signedUrl + '&t=' + Date.now()
    }
  })

  // --- Datos de perfil ---
  container.querySelector('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const msg = container.querySelector('#profile-msg')
    const formData = new FormData(e.target)

    const updates = {
      display_name: formData.get('display_name').trim(),
      age: formData.get('age') ? Number(formData.get('age')) : null,
      gender: formData.get('gender') || null,
      height_cm: formData.get('height_cm') ? Number(formData.get('height_cm')) : null,
    }

    const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)
    showResult(msg, error)
  })

  // --- Medidas corporales ---
  container.querySelector('#measurements-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const msg = container.querySelector('#measurements-msg')
    const formData = new FormData(e.target)

    const row = {
      user_id: user.id,
      measured_on: today,
      weight_kg: formData.get('weight_kg') ? Number(formData.get('weight_kg')) : null,
      body_fat_pct: formData.get('body_fat_pct') ? Number(formData.get('body_fat_pct')) : null,
      muscle_pct: formData.get('muscle_pct') ? Number(formData.get('muscle_pct')) : null,
    }

    const { error } = await supabase.from('body_measurements').upsert(row, { onConflict: 'user_id,measured_on' })
    showResult(msg, error)
  })

  // --- Cambio de contraseña ---
  container.querySelector('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const msg = container.querySelector('#password-msg')
    const formData = new FormData(e.target)
    const p1 = formData.get('password')
    const p2 = formData.get('password2')

    if (p1 !== p2) {
      msg.textContent = 'Las contraseñas no coinciden'
      msg.className = 'msg error'
      return
    }

    const { error } = await supabase.auth.updateUser({ password: p1 })
    showResult(msg, error, 'Contraseña cambiada ✓')
    if (!error) e.target.reset()
  })

  // --- Cerrar sesion ---
  container.querySelector('#logout-btn').addEventListener('click', () => supabase.auth.signOut())
}

function showResult(msgEl, error, successText = 'Guardado ✓') {
  msgEl.textContent = error ? 'Error: ' + error.message : successText
  msgEl.className = error ? 'msg error' : 'msg success'
}

function placeholderAvatar() {
  return (
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect width="100" height="100" fill="#E7ECE0"/>
      <circle cx="50" cy="38" r="18" fill="#B7C4A8"/>
      <ellipse cx="50" cy="88" rx="32" ry="24" fill="#B7C4A8"/>
    </svg>
  `)
  )
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
