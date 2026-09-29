import './style.css'
import { supabase } from './supabaseClient.js'
import { renderLogin } from './views/login.js'
import { renderProfile } from './views/profile.js'
import { renderToday } from './views/today.js'
import { renderCalendar } from './views/calendar.js'

const app = document.querySelector('#app')
let currentView = 'hoy'

async function render(session) {
  if (!session) {
    renderLogin(app)
    return
  }

  app.innerHTML = `
    <header class="topbar">
      <span class="brand">🥇 Reto Mensual</span>
    </header>
    <nav class="tabs">
      <button class="tab" data-view="hoy">Hoy</button>
      <button class="tab" data-view="calendario">Calendario</button>
      <button class="tab" data-view="perfil">Perfil</button>
    </nav>
    <main id="main-content"></main>
  `

  const tabs = app.querySelectorAll('.tab')

  function updateActiveTab() {
    tabs.forEach((btn) => btn.classList.toggle('active', btn.dataset.view === currentView))
  }

  async function renderCurrentView() {
    const container = document.querySelector('#main-content')
    if (currentView === 'hoy') {
      await renderToday(container, session.user)
    } else if (currentView === 'calendario') {
      await renderCalendar(container, session.user)
    } else {
      await renderProfile(container, session.user)
    }
  }

  tabs.forEach((btn) => {
    btn.addEventListener('click', async () => {
      currentView = btn.dataset.view
      updateActiveTab()
      await renderCurrentView()
    })
  })

  updateActiveTab()
  await renderCurrentView()
}

// Primer render al cargar la pagina
const {
  data: { session },
} = await supabase.auth.getSession()
render(session)

// Cada vez que alguien entra o sale, se vuelve a pintar la pantalla sola
supabase.auth.onAuthStateChange((_event, session) => {
  currentView = 'hoy'
  render(session)
})
