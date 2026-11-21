// main.js — Motor principal: máquina de estados, AUTO, evento 'ended', manejo de UI
'use strict';

// Helper $ (debe existir antes; definido en seg7.js)
if (typeof $ === 'undefined') {
  window.$ = (sel, r = document) => { const e = r.querySelector(sel); if (!e) console.error('Falta elemento en el HTML:', sel); return e; };
}

// Referencias globales
let decks = { A: null, B: null }; // se poblará en DOMContentLoaded
let library = window.Library || { init: () => {}, tracks: [], select: () => {}, load: () => {}, render: () => {} };

// MÁQUINA DE ESTADOS POR DECK
// Estados: CLOSED → LOADING → READY → PLAYING ↔ PAUSED → ENDED → (nueva carga) LOADING
// Errores: ERROR con mensaje "NOT LOADED!"

const StateMachine = {
  // Transición de estado con validación
  transition(deck, newState) {
    const validTransitions = {
      CLOSED: ['LOADING', 'ERROR'],
      LOADING: ['READY', 'ERROR'],
      READY: ['PLAYING', 'PAUSED', 'CLOSED'],
      PLAYING: ['PAUSED', 'ENDED'],
      PAUSED: ['PLAYING', 'READY', 'CLOSED'],
      ENDED: ['LOADING', 'READY', 'CLOSED'],
      ERROR: ['LOADING', 'CLOSED']
    };

    if (validTransitions[deck.state] && validTransitions[deck.state].includes(newState)) {
      deck.state = newState;
      deck.draw();
      return true;
    }
    return false;
  },

  // Marcar ERROR en un deck
  error(deck, reason) {
    deck.state = 'ERROR';
    deck.elMessage.textContent = 'NOT LOADED!';
    deck.draw();
  }
};

// INICIALIZAR DECKS cuándo el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  // Esperar un momento a que los scripts cargados añadan el HTML
  setTimeout(() => {
    // Crear decks para A y B
    decks = {
      A: new Deck({ id: 'a', root: $('#player-a'), ctx: window.ctx, xfade: window.xfade, masterGain: null }),
      B: new Deck({ id: 'b', root: $('#player-b'), ctx: window.ctx, xfade: window.xfade, masterGain: null })
    };

    // Inicializar biblioteca
    library.init();

    // Vincular decks con library para comunicación
    library.decks = decks;

    // Mostrar mensaje inicial
    library.render();
  }, 500);
});

// LÓGICA AUTO (modo automático)
// Cuando al deck que suena le queden ≤ 20 s, precarga en el deck libre la siguiente pista NO reproducida
// Cuando le queden ≤ crossfadeSec (8 s), arranca el otro deck y anima el crossfader
// Si el usuario toca el crossfader durante la transición, cancela la animación automática
// Al terminar, el deck saliente pasa a ENDED (botón rojo) y el entrante parpadea

const AutoMode = {
  crossfadeSec: 8, // segundos
  pendingTransition: null,

  start(decksRef) {
    this.decks = decksRef;
    this._startLoop();
  },

  _startLoop() {
    this._checkTransition();
    this.interval = setInterval(() => this._checkTransition(), 500); // medio segundo
  },

  _checkTransition() {
    // Buscar el deck que está sonando
    let playingDeck = null;
    let otherDeck = null;

    for (const key of ['A', 'B']) {
      const d = this.decks[key];
      if (!d) continue;
      if (d.state === 'PLAYING') {
        playingDeck = d;
      } else if (d.state === 'READY' && !otherDeck) {
        otherDeck = d;
      }
    }

    if (!playingDeck) return;

    const currentTime = playingDeck.audio ? playingDeck.audio.currentTime : 0;
    const duration = playingDeck.audio ? playingDeck.audio.duration : 0;
    const remaining = Number.isFinite(duration) && duration > 0 ? duration - currentTime : 0;

    // Si quedan ≤ 20 s, precargar siguiente pista NO reproducida en el otro deck
    if (remaining <= 20 && otherDeck && otherDeck.state !== 'PLAYING') {
      this._precargarSiguiente(otherDeck);
    }

    // Si quedan ≤ crossfadeSec (8 s), arrancar el otro deck y animar crossfader
    if (remaining <= this.crossfadeSec && otherDeck && otherDeck.state !== 'PLAYING') {
      this._arrancarTransicion(playingDeck, otherDeck);
    }

    // Si la pista terminó (ended), manejar
    if (remaining <= 0) {
      this._procesarFinPista(playingDeck);
    }
  },

  _precargarSiguiente(deck) {
    // Buscar la siguiente pista NO reproducida en la lista
    const tracks = library.tracks.filter(t => !t.played);
    if (tracks.length === 0) return;

    let nextTrack;
    if (Library.shuffle) {
      // Aleatoria entre las no reproducidas
      nextTrack = tracks[Math.floor(Math.random() * tracks.length)];
    } else {
      // Siguiente en orden de lista
      // Buscar la primera que no sea la que está sonando ni la del otro deck
      const currentIdx = library.tracks.findIndex(t => t.id === playingDeck.track?.id);
      const startIdx = currentIdx >= 0 ? currentIdx + 1 : 0;
      for (let i = 0; i < library.tracks.length; i++) {
        const idx = (startIdx + i) % library.tracks.length;
        const t = library.tracks[idx];
        if (!t.played && t.id !== playingDeck.track?.id) {
          nextTrack = t;
          break;
        }
      }
    }

    if (nextTrack) {
      // Cargar en el otro deck pero no reproducir todavía
      otherDeck.load(nextTrack);
      Library.select(nextTrack);
    }
  },

  _arrancarTransicion(deckSaliente, deckEntrante) {
    // Marcar que hay transición pending
    this.pendingTransition = { deckSaliente, deckEntrante };

    // Cargar la pista en el deck entrante si no tiene una
    if (!deckEntrante.track || deckEntrante.track.url !== deckEntrante.track.url) {
      // Ya debería haber sido cargada en _precargarSiguiente, pero por si acaso
    }

    // Animar crossfader con curva de potencia constante
    const startValue = 0; // A es 1, B es -1, medio es 0
    const endValue = -1; // Mover totalmente al deck entrante (B = -1)
    const steps = 8; // 8 frames/updates en crossfadeSec segundos
    const stepValue = (endValue - startValue) / steps; // -1/8 = -0.125 por step

    let current = startValue;
    const id = setInterval(() => {
      current += stepValue;
      current = Math.max(-1, Math.min(1, current));
      window.setXf(current);
      
      if (Math.abs(current - endValue) < Math.abs(stepValue)) {
        window.setXf(endValue);
        clearInterval(id);
        this._finishTransition(deckSaliente, deckEntrante);
      }
    }, this.crossfadeSec / steps);
  },

  _finishTransition(deckSaliente, deckEntrante) {
    // Parar la transición
    this.pendingTransition = null;

    // El deck saliente pasa a ENDED
    StateMachine.transition(deckSaliente, 'ENDED');
    deckSaliente.elStatus.textContent = 'ENDED';
    // Poner LED rojo fijo
    if (deckSaliente.elLedStrip) {
      Array.from(deckSaliente.elLedStrip.children).forEach(led => led.style.background = 'var(--led-red)');
    }

    // El deck entrante parpadea con halo verde lima
    deckEntrante.elStatus.textContent = 'READY';
    this._startBlink(deckEntrante, '#2bd13a');

    // Si no quedan pistas sin reproducir, parar y mostrar "FIN DE LISTA"
    const remainingNonPlayed = library.tracks.filter(t => !t.played).length;
    if (remainingNonPlayed === 0) {
      const miniViewer = $('#mini-viewer');
      if (miniViewer) {
        miniViewer.textContent = 'FIN DE LISTA';
      }
      // Detener auto mode
      this.stop();
    }
  },

  _startBlink(deck, color) {
    const el = deck.elStatus;
    let opacity = 1;
    const id = setInterval(() => {
      opacity = opacity === 1 ? 0.3 : 1;
      el.style.color = color;
      el.style.textShadow = opacity ? `0 0 8px ${color}` : 'none';
    }, 900);
    // Guardar el interval para poder limpiarlo
    deck._blinkInterval = id;
  },

  stop() {
    if (this.interval) clearInterval(this.interval);
    if (this.pendingTransition) clearInterval(this.pendingTransition);
    window.setXf(0); // crossfader al centro
    $('#cf-value').textContent = '50%';
  }
};

// Manejador cuando una pista termina (evento 'ended')
document.addEventListener('ended', (e) => {
  // e.target es el audio element
  // Buscar qué deck lo tiene
  for (const key of ['A', 'B']) {
    const d = decks[key];
    if (d && d.audio === e.target) {
      // La pista terminó en este deck
      StateMachine.transition(d, 'ENDED');
      d.elStatus.textContent = 'ENDED';
      // LED rojo fijo
      if (d.elLedStrip) {
        Array.from(d.elLedStrip.children).forEach(led => led.style.background = 'var(--led-red)');
      }
      // Parar auto mode transición
      AutoMode.stop();
      
      // Mostrar "FIN DE LISTA" si no quedan pistas
      const remainingNonPlayed = library.tracks.filter(t => !t.played).length;
      if (remainingNonPlayed === 0) {
        const miniViewer = $('#mini-viewer');
        if (miniViewer) miniViewer.textContent = 'FIN DE LISTA';
      }
      break;
    }
  }
});

// Manejador cuando el usuario interactúa con el crossfader durante transición
// (Se hace en setXf - si el usuario arrastra, cancelar animación auto)
// Ya está en setXf que chequea, pero añadamos un flag global
let autoModeActive = true;
document.addEventListener('pointerdown', () => {
  // Si hay transición pending y el usuario pulsa, cancelarla
  if (AutoMode.pendingTransition) {
    AutoMode.stop();
  }
});

// Helper: toggle reduce-motion para parpadeo suave
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
if (prefersReduced.matches) {
  // Quitar todos los intervalos de parpadeo
  for (const d of Object.values(decks)) {
    if (d._blinkInterval) clearInterval(d._blinkInterval);
  }
}

// Exportar
window.AutoMode = AutoMode;
window.StateMachine = StateMachine;
window.Library = Library;
window.decks = decks;