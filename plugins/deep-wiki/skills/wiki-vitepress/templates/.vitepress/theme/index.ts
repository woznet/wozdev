import DefaultTheme from 'vitepress/theme'
import { onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vitepress'
import mediumZoom, { type Zoom } from 'medium-zoom'
import './custom.css'

// All DOM work runs from setup() hooks, never enhanceApp(): enhanceApp also runs
// during SSR, where `document` does not exist.

let imageZoom: Zoom | undefined

/** Attach medium-zoom to the current page's images (one instance, re-targeted per route). */
function setupImageZoom() {
  imageZoom ??= mediumZoom({ background: 'rgba(13, 17, 23, 0.95)', margin: 24 })
  imageZoom.detach()
  imageZoom.attach('.vp-doc img:not(.no-zoom)')
}

/** Open a diagram in a native modal <dialog> with wheel/button zoom and drag-to-pan. */
function openDiagramModal(svg: SVGSVGElement, trigger: HTMLElement) {
  const dialog = document.createElement('dialog')
  dialog.className = 'mermaid-modal'
  dialog.setAttribute('aria-label', 'Enlarged diagram')

  const controls = document.createElement('div')
  controls.className = 'mermaid-modal-controls'
  controls.innerHTML = `
    <button type="button" data-action="in" aria-label="Zoom in">+</button>
    <button type="button" data-action="out" aria-label="Zoom out">−</button>
    <button type="button" data-action="reset" aria-label="Reset zoom">Reset</button>
    <button type="button" data-action="close" aria-label="Close diagram">✕</button>`

  const viewport = document.createElement('div')
  viewport.className = 'mermaid-modal-viewport'
  const stage = document.createElement('div')
  stage.className = 'mermaid-modal-stage'

  // Clone, never move: moving the SVG would break the page layout.
  const clone = svg.cloneNode(true) as SVGSVGElement
  if (!clone.getAttribute('viewBox')) {
    const box = svg.getBBox()
    clone.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`)
  }
  clone.removeAttribute('width')
  clone.removeAttribute('height')
  clone.style.maxWidth = 'none'
  stage.appendChild(clone)
  viewport.appendChild(stage)
  dialog.append(controls, viewport)

  let scale = 1
  let x = 0
  let y = 0
  const apply = () => {
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  }
  const zoom = (factor: number) => {
    scale = Math.min(Math.max(scale * factor, 0.2), 6)
    apply()
  }
  const reset = () => {
    scale = 1
    x = 0
    y = 0
    apply()
  }

  controls.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action
    if (action === 'in') zoom(1.25)
    if (action === 'out') zoom(1 / 1.25)
    if (action === 'reset') reset()
    if (action === 'close') dialog.close()
  })
  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      zoom(e.deltaY > 0 ? 0.9 : 1.1)
    },
    { passive: false },
  )

  // Pointer events on the viewport only (with capture), so nothing is left
  // attached to `document` after the dialog closes.
  let panning = false
  let startX = 0
  let startY = 0
  viewport.addEventListener('pointerdown', (e) => {
    panning = true
    startX = e.clientX - x
    startY = e.clientY - y
    viewport.setPointerCapture(e.pointerId)
    viewport.classList.add('is-panning')
  })
  viewport.addEventListener('pointermove', (e) => {
    if (!panning) return
    x = e.clientX - startX
    y = e.clientY - startY
    apply()
  })
  const endPan = (e: PointerEvent) => {
    panning = false
    if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId)
    viewport.classList.remove('is-panning')
  }
  viewport.addEventListener('pointerup', endPan)
  viewport.addEventListener('pointercancel', endPan)

  dialog.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') zoom(1.25)
    if (e.key === '-') zoom(1 / 1.25)
    if (e.key === '0') reset()
    // Keyboard panning: the viewport hides overflow, so arrows reach the rest of a zoomed diagram.
    const PAN_STEP = 40
    const pan: Record<string, [number, number]> = {
      ArrowLeft: [PAN_STEP, 0],
      ArrowRight: [-PAN_STEP, 0],
      ArrowUp: [0, PAN_STEP],
      ArrowDown: [0, -PAN_STEP],
    }
    const step = pan[e.key]
    if (step) {
      e.preventDefault()
      x += step[0]
      y += step[1]
      apply()
    }
  })
  // Escape closes a modal <dialog> natively. Removing the element drops every listener above.
  dialog.addEventListener('close', () => {
    dialog.remove()
    trigger.focus()
  })

  document.body.appendChild(dialog)
  dialog.showModal()
  controls.querySelector<HTMLButtonElement>('[data-action="close"]')?.focus()
}

/** Mermaid renders asynchronously after mount, so poll briefly and bind each diagram once. */
function setupMermaidZoom() {
  let attempts = 0
  const bind = () => {
    document.querySelectorAll<HTMLElement>('.mermaid-diagram, .vp-doc .mermaid').forEach((el) => {
      if (el.dataset.zoomBound) return
      const svg = el.querySelector('svg')
      if (!svg) return
      el.dataset.zoomBound = '1'
      el.classList.add('mermaid-zoomable')
      el.tabIndex = 0
      el.setAttribute('role', 'button')
      el.setAttribute('aria-label', 'Enlarge diagram')
      const open = () => openDiagramModal(svg, el)
      el.addEventListener('click', open)
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      })
    })
    if (attempts++ < 20) setTimeout(bind, 250)
  }
  bind()
}

/** A floating button (and the F key) that hides the sidebar and outline. Created once. */
function setupFocusMode() {
  if (document.querySelector('.focus-toggle')) return
  const toggle = () => document.documentElement.classList.toggle('focus-mode')

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'focus-toggle'
  btn.setAttribute('aria-label', 'Toggle focus mode')
  btn.title = 'Focus mode (F)'
  btn.textContent = '⤢'
  btn.addEventListener('click', toggle)
  document.body.appendChild(btn)

  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement
    if (
      e.key.toLowerCase() === 'f' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !target.isContentEditable &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) &&
      !document.querySelector('dialog[open]')
    ) {
      e.preventDefault()
      toggle()
    }
  })
}

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute()
    const init = () => {
      setupImageZoom()
      setupMermaidZoom()
      setupFocusMode()
    }
    onMounted(init)
    watch(
      () => route.path,
      () => nextTick(init),
    )
  },
}
