// library.js — Gestión de la biblioteca, filtro, marcas de reproducida, AUTO y arrastre
'use strict';

// Helper $ (debe existir antes; definido en seg7.js o main.js)
if (typeof $ === 'undefined') {
  window.$ = (sel, r = document) => { const e = r.querySelector(sel); if (!e) console.error('Falta elemento en el HTML:', sel); return e; };
}

// Estado de la biblioteca
const Library = {
  tracks: [],       // Array de {id, name, title, artist, url, dur, played: boolean}
  sel: null,        // Pista seleccionada actualmente
  autoMode: false,  // Modo AUTO activado
  shuffle: false,   // Modo shuffle dentro de AUTO
  lastPlayed: null, // Última pista que sonaba
  playedKeyVersion: 'v1', // Versión del esquema localStorage

  // Inicializar: cargar pistas y marcas de reproducida
  init() {
    this._loadPlayedFromStorage();
    this.render();
  },

  // Cargar marcas de reproducida de localStorage
  _loadPlayedFromStorage() {
    try {
      const data = localStorage.getItem('hammer:played:' + this.playedKeyVersion);
      if (data) {
        const parsed = JSON.parse(data);
        // Cada entrada: {name: string, size: number, lastModified: number, played: boolean}
        this.tracks = parsed.map(t => ({ ...t, played: t.played || false }));
      }
    } catch (e) {
      console.error('Error loading played marks:', e);
    }
  },

  // Guardar marcas de reproducida en localStorage
  _savePlayedToStorage() {
    try {
      const data = JSON.stringify(this.tracks);
      localStorage.setItem('hammer:played:' + this.playedKeyVersion, data);
    } catch (e) {
      console.error('Error saving played marks:', e);
    }
  },

  // Añadir una o varias pistas (archivos)
  add(files) {
    const added = [];
    [...files].filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus)$/i.test(f.name)).forEach(f => {
      // Nombre: quitar prefijo "SpotiDown.App - " y extensión
      let name = f.name.replace(/\.[^.]+$/, '').replace(/^SpotiDown\.App\s*-\s*/i, '');
      // Dividir en título y artista en " - "
      const sepIdx = name.lastIndexOf(' - ');
      const title = sepIdx > 0 ? name.slice(0, sepIdx) : name;
      const artist = sepIdx > 0 ? name.slice(sepIdx + 3) : '';

      const track = {
        id: Date.now() + Math.random(), // ID único
        name,
        title,
        artist,
        url: URL.createObjectURL(f),
        dur: null, // se cargará después
        size: f.size,
        lastModified: f.lastModified,
        played: false // marca inicial
      };

      // Si ya existe una pista con mismo nombre+tamaño, no la duplicamos
      const exists = this.tracks.some(t => t.name === track.name && t.size === track.size);
      if (!exists) {
        this.tracks.push(track);
        added.push(track);
      }
    });

    if (added.length > 0) {
      this._savePlayedToStorage();
      this.render();
    }
    return added;
  },

  // Eliminar pistas marcadas
  clearMarked() {
    this.tracks = this.tracks.filter(t => !t.played);
    this._savePlayedToStorage();
    this.render();
  },

  // Ocultar pistas reproducidas
  hideMarked() {
    // No eliminamos, solo cambiamos la clase CSS o la visibilidad
    this.render();
  },

  // Filtrar en vivo
  filter(query) {
    query = (query || '').toLowerCase();
    this.render(query);
  },

  // Renderizar la tabla de la biblioteca
  render(filter = '') {
    const tbody = $('#library-rows');
    const empty = $('#lib-empty');

    let html = '';
    let hasVisible = false;

    this.tracks.forEach((t, i) => {
      // Filtrar por artista o título
      const matchesFilter = !filter || 
        t.title.toLowerCase().includes(filter) || 
        t.artist.toLowerCase().includes(filter) ||
        t.name.toLowerCase().includes(filter);

      if (!matchesFilter) return; // skip this track

      hasVisible = true;
      const playedClass = t.played ? ' played' : '';
      const hidClass = t.played && Library.chkHide ? ' hid' : ''; // checkbox para ocultar

      // BPM (siempre "---" en esta versión, no inventamos BPM)
      const bpm = '---';

      html += `<tr draggable="true" data-id="${t.id}" class="${t === this.sel ? 'sel' : ''}${playedClass}${hidClass}">
        <td><input type="checkbox" data-played "${t.played ? 'checked' : ''}" class="chk-played"></td>
        <td>${bpm}</td>
        <td title="${t.artist}">${t.artist}</td>
        <td title="${t.title}">${t.title}</td>
        <td>${t.version || ''}</td>
        <td>${t.comment || ''}</td>
      </tr>`;
    });

    if (hasVisible) {
      empty.style.display = 'none';
      tbody.innerHTML = html;
    } else {
      empty.style.display = 'grid';
      tbody.innerHTML = '';
    }
  },

  // Seleccionar una pista (clic simple)
  select(track) {
    this.sel = track;
    this.render();
    return track;
  },

  // Cargar pista en un deck
  load(track, deckId = 'a') {
    const deck = window.decks[deckId];
    if (deck) {
      deck.load(track);
      // Marcar como reproducida si ya estaba sonando o al terminar
      if (deck.state === 'PLAYING' || deck.state === 'PAUSED') {
        track.played = true;
        this._savePlayedToStorage();
        this.render();
      }
    }
  },

  // Modo AUTO
  setAutoMode(enabled) {
    this.autoMode = enabled;
    $('#btn-auto').classList.toggle('active', enabled);
  },

  // Toggle shuffle dentro de AUTO
  setShuffle(enabled) {
    this.shuffle = enabled;
  }
};

// Inicializar cuando el DOM esté listo
if (window.decks) {
  // Ya hay decks inicializados, solo inicializar biblioteca
  Library.init();
} else {
  // Esperar a que main.js los cree
  document.addEventListener('DOMContentLoaded', () => { setTimeout(() => Library.init(), 100); });
}

// Exportar si es módulo
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Library };
}

// Helper $ global si no existe
if (typeof window.$ === 'undefined') {
  window.$ = (sel, r = document) => { const e = r.querySelector(sel); if (!e) console.error('Falta elemento en el HTML:', sel); return e; };
}