// Abre la camara del dispositivo en directo y devuelve la foto confirmada
// como Blob (o null si se cancela). No usa <input type="file">, asi que
// no hay forma de elegir una foto de la galeria: solo se puede capturar
// lo que la camara esta viendo en ese momento.
export function openCamera() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'camera-overlay'
    overlay.innerHTML = `
      <button class="camera-close" id="camera-close" aria-label="Cerrar">✕</button>

      <video autoplay playsinline muted></video>
      <canvas class="camera-preview" hidden></canvas>
      <p class="camera-error msg error" hidden></p>

      <div class="camera-controls" id="controls-live">
        <button class="button ghost" id="camera-cancel">Cancelar</button>
        <button class="button primary" id="camera-shot">📸 Capturar</button>
      </div>
      <div class="camera-controls" id="controls-preview" hidden>
        <button class="button ghost" id="camera-retake">↺ Repetir</button>
        <button class="button primary" id="camera-confirm">✓ Usar esta foto</button>
      </div>
    `
    document.body.appendChild(overlay)

    const video = overlay.querySelector('video')
    const canvas = overlay.querySelector('canvas')
    const errorEl = overlay.querySelector('.camera-error')
    const controlsLive = overlay.querySelector('#controls-live')
    const controlsPreview = overlay.querySelector('#controls-preview')

    let stream = null
    let capturedBlob = null

    function cleanup() {
      if (stream) stream.getTracks().forEach((track) => track.stop())
      overlay.remove()
    }

    function finish(result) {
      cleanup()
      resolve(result)
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        stream = s
        video.srcObject = s
      })
      .catch((err) => {
        errorEl.hidden = false
        errorEl.textContent = 'No se puede acceder a la cámara: ' + err.message
      })

    // Cerrar sin hacer foto (vuelve a "Hoy" tal cual estaba)
    overlay.querySelector('#camera-close').addEventListener('click', () => finish(null))
    overlay.querySelector('#camera-cancel').addEventListener('click', () => finish(null))

    // Capturar el fotograma actual y mostrarlo como vista previa
    overlay.querySelector('#camera-shot').addEventListener('click', () => {
      if (!stream) return
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d').drawImage(video, 0, 0)
      canvas.toBlob(
        (blob) => {
          capturedBlob = blob
          video.hidden = true
          canvas.hidden = false
          controlsLive.hidden = true
          controlsPreview.hidden = false
        },
        'image/jpeg',
        0.85
      )
    })

    // Descartar la vista previa y volver a la camara en directo
    overlay.querySelector('#camera-retake').addEventListener('click', () => {
      capturedBlob = null
      video.hidden = false
      canvas.hidden = true
      controlsLive.hidden = false
      controlsPreview.hidden = true
    })

    // Confirmar: esta es la foto que se sube
    overlay.querySelector('#camera-confirm').addEventListener('click', () => {
      finish(capturedBlob)
    })
  })
}
