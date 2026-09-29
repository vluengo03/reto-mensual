import { supabase } from '../supabaseClient.js'

export function renderLogin(container) {
  container.innerHTML = `
    <div class="login-screen">
      <h1 class="brand">🥇 Reto Mensual</h1>
      <p class="muted">Entra con la cuenta que os he creado.</p>
      <form id="login-form" class="card">
        <label>Email
          <input type="email" name="email" required autocomplete="username" />
        </label>
        <label>Contraseña
          <input type="password" name="password" required autocomplete="current-password" />
        </label>
        <button type="submit" class="button primary">Entrar</button>
        <p id="login-msg" class="msg"></p>
      </form>
    </div>
  `

  container.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const msg = container.querySelector('#login-msg')
    const formData = new FormData(e.target)

    msg.textContent = 'Entrando…'
    msg.className = 'msg'

    const { error } = await supabase.auth.signInWithPassword({
      email: formData.get('email').trim(),
      password: formData.get('password'),
    })

    if (error) {
      console.error(error)
      msg.textContent = error.message
      msg.className = 'msg error'
    }
    // Si el login funciona, main.js se entera solo y cambia de pantalla
  })
}
