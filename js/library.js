// library.js — Biblioteca: archivos reales, filtro, marcas persistentes, arrastre y carga
'use strict';

if (typeof $ === 'undefined') {
  window.$ = (sel, r = document) => {
    const e = r.querySelector(sel);
    if (!e) console.error('Falta elemento en el HTML:', sel);
    return e;
  };
}

const Library = {
  tracks: [],
  sel: null,
  autoMode: false,
  shuffle: false,
  hidePlayed: false,
  filterText: '',
  playedKey: 'hammer:played:v1',
  _inited: false,

  // ---------- Init ----------
  init() {
    if (this._inited) return;
    this._inited = true;
    this._bindUI();
    this.render();
  },

  _bindUI() {
    const self = this;
    const fileInput = $('#file-input');
    const addBtn = $('#btn-add');
    if (addBtn && fileInput) addBtn.addEventListener('click', () => fileInput.click());
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        self.add(fileInput.files);
        fileInput.value = '';
      });
    }

    const filter = $('#lib-filter');
    if (filter) filter.addEventListener('input', () => {
      self.filterText = filter.value || '';
      self.render();
    });

    const auto = $('#btn-auto');
    if (auto) auto.addEventListener('click', () => self.setAuto(!self.autoMode));

    const shfl = $('#chk-shuffle');
    if (shfl) shfl.addEventListener('change', () => self.setShuffle(shfl.checked));

    const hide = $('#chk-hide-hidden');
    if (hide) hide.addEventListener('change', () => self.setHide(hide.checked));

    const reset = $('#btn-reset');
    if (reset) reset.addEventListener('click', () => self.clearMarks());

    const loadA = $('#btn-load-a');
    const loadB = $('#btn-load-b');
    if (loadA) loadA.addEventListener('click', () => self.loadSelected('A'));
    if (loadB) loadB.addEventListener('click', () => self.loadSelected('B'));

    // Tabla: clic = seleccionar, check = marcar, doble clic = cargar, arrastre = cargar
    const tbody = $('#library-rows');
    if (tbody) {
      tbody.addEventListener('change', (e) => {
        const chk = e.target.closest('.chk-played');
        if (!chk) return;
        const row = chk.closest('tr');
        if (row) self.togglePlayed(Number(row.dataset.id));
      });
      tbody.addEventListener('click', (e) => {
        if (e.target.closest('.chk-played')) return;
        const row = e.target.closest('tr');
        if (!row) return;
        const track = self.tracks.find(t => String(t.id) === row.dataset.id);
        if (track) self.select(track);
      });
      tbody.addEventListener('dblclick', (e) => {
        if (e.target.closest('.chk-played')) return;
        const row = e.target.closest('tr');
        if (!row) return;
        const track = self.tracks.find(t => String(t.id) === row.dataset.id);
        if (!track) return;
        self.select(track);
        self.loadTo(track, self._preferredDeck());
      });
      tbody.addEventListener('dragstart', (e) => {
        const row = e.target.closest('tr');
        if (!row) return;
        e.dataTransfer.setData('text/plain', row.dataset.id);
        e.dataTransfer.effectAllowed = 'copy';
        const track = self.tracks.find(t => String(t.id) === row.dataset.id);
        if (track) self.select(track);
      });
    }

    // Arrastre de archivos: biblioteca / app y también cualquier zona libre del documento.
    const app = $('.app');
    const lib = $('.library');
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    const hasFiles = (e) => {
      const dt = e.dataTransfer;
      if (!dt) return false;
      const types = Array.from(dt.types || []);
      return types.includes('Files') || !!(dt.files && dt.files.length);
    };

    [app, lib].filter(Boolean).forEach(zone => {
      zone.addEventListener('dragenter', (e) => { stop(e); zone.classList.add('drag-over'); });
      zone.addEventListener('dragover', (e) => {
        stop(e);
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      zone.addEventListener('dragleave', (e) => {
        if (e.target === zone || !zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
      });
      zone.addEventListener('drop', (e) => {
        stop(e);
        zone.classList.remove('drag-over');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          self.add(e.dataTransfer.files);
        }
      });
    });

    // Los decks detienen la propagación, así que esto solo se ejecuta en zonas libres.
    document.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      if (app) app.classList.add('drag-over');
    });
    document.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget && app) app.classList.remove('drag-over');
    });
    document.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (app) app.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files) self.add(e.dataTransfer.files);
    });
    document.addEventListener('dragend', () => {
      if (app) app.classList.remove('drag-over');
      if (lib) lib.classList.remove('drag-over');
    });

    // Ctrl+V
    document.addEventListener('paste', (e) => {
      const files = e.clipboardData && e.clipboardData.files;
      if (files && files.length) {
        const added = self.add(files);
        if (added.length) window.setStatus && window.setStatus('Pegadas ' + added.length + ' pista(s)');
      }
    });
  },

  // ---------- Persistencia de marcas ----------
  _key(t) {
    return [t.name, t.size, t.lastModified].join('|');
  },

  _readMap() {
    try {
      const raw = localStorage.getItem(this.playedKey);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === 'object' ? obj : {};
    } catch (_) { return {}; }
  },

  _writeMap() {
    const map = {};
    this.tracks.forEach(t => { map[this._key(t)] = !!t.played; });
    try { localStorage.setItem(this.playedKey, JSON.stringify(map)); } catch (_) { /* ignore */ }
  },

  // ---------- Archivos ----------
  _cleanName(f) {
    return (f.name || 'pista')
      .replace(/\.[^.]+$/, '')
      .replace(/^SpotiDown\.App\s*-\s*/i, '');
  },

  add(files) {
    const list = Array.from(files || []).filter(f =>
      (f.type && f.type.startsWith('audio/')) ||
      /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus)$/i.test(f.name || '')
    );
    const map = this._readMap();
    const added = [];

    list.forEach(f => {
      const name = this._cleanName(f);
      const sep = name.lastIndexOf(' - ');
      const title = sep > 0 ? name.slice(0, sep).trim() : name.trim();
      const artist = sep > 0 ? name.slice(sep + 3).trim() : '';
      const key = [name, f.size, f.lastModified].join('|');

      if (this.tracks.some(t => this._key(t) === key)) return;
      const track = {
        id: Date.now() + Math.random(),
        name, title, artist,
        url: URL.createObjectURL(f),
        dur: null,
        size: f.size,
        lastModified: f.lastModified,
        version: '',
        comment: '',
        bpm: '---',
        played: !!map[key]
      };
      this.tracks.push(track);
      added.push(track);
    });

    if (added.length) {
      if (!this.sel) this.sel = added[0]; // para que → A / → B funcionen nada más añadir
      this._writeMap();
      this.render();
      window.setStatus && window.setStatus('Añadidas ' + added.length + ' pista(s)');
    } else if (list.length) {
      window.setStatus && window.setStatus('Ese archivo ya está en la biblioteca');
    }
    return added;
  },

  // Devuelve las pistas de la biblioteca correspondientes a estos archivos
  // (incluidas las que ya estaban). Lo usan los decks al soltar archivos.
  tracksForFiles(files) {
    return Array.from(files || []).map(f => {
      const key = [this._cleanName(f), f.size, f.lastModified].join('|');
      return this.tracks.find(t => this._key(t) === key) || null;
    }).filter(Boolean);
  },

  addFiles(files) {
    this.add(files);
    return this.tracksForFiles(files);
  },

  // ---------- Render ----------
  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  },

  render(filter) {
    const tbody = $('#library-rows');
    const empty = $('#lib-empty');
    if (!tbody) return;
    if (typeof filter === 'string') this.filterText = filter;
    const q = (this.filterText || '').toLowerCase();

    let html = '';
    let visible = 0;
    this.tracks.forEach(t => {
      const matches = !q ||
        String(t.title || '').toLowerCase().includes(q) ||
        String(t.artist || '').toLowerCase().includes(q) ||
        String(t.name || '').toLowerCase().includes(q);
      if (!matches) return;
      if (this.hidePlayed && t.played) return;
      visible++;
      const cls = [t === this.sel ? 'sel' : '', t.played ? 'played' : ''].filter(Boolean).join(' ');
      html += '<tr draggable="true" data-id="' + this._esc(t.id) + '" class="' + cls + '">' +
        '<td><input type="checkbox" class="chk-played" ' + (t.played ? 'checked' : '') + ' aria-label="Marcar reproducida"></td>' +
        '<td>' + this._esc(t.bpm || '---') + '</td>' +
        '<td title="' + this._esc(t.artist) + '">' + this._esc(t.artist) + '</td>' +
        '<td title="' + this._esc(t.title) + '">' + this._esc(t.title) + '</td>' +
        '<td>' + this._esc(t.version) + '</td>' +
        '<td>' + this._esc(t.comment) + '</td>' +
        '</tr>';
    });

    tbody.innerHTML = html;
    if (empty) empty.style.display = visible ? 'none' : 'grid';
    const count = $('#track-count');
    if (count) count.textContent = String(this.tracks.length);
  },

  // ---------- Selección / carga ----------
  select(track) {
    this.sel = track || null;
    this.render();
    return this.sel;
  },

  _preferredDeck() {
    const A = window.decks && window.decks.A;
    const B = window.decks && window.decks.B;
    if (!A || !A.track) return 'A';
    if (!B || !B.track) return 'B';
    return A.state === 'PLAYING' ? 'B' : 'A';
  },

  loadTo(track, deckId) {
    if (!track) return;
    const key = String(deckId || 'A').toUpperCase();
    const deck = window.decks && window.decks[key];
    if (!deck) return;
    this.select(track);
    deck.load(track);
    window.setStatus && window.setStatus(track.title + ' → Player ' + key);
  },

  loadSelected(deckId) {
    if (!this.sel) {
      window.setStatus && window.setStatus('Selecciona una pista primero');
      return;
    }
    this.loadTo(this.sel, deckId);
  },

  loadAdjacent(deckId, dir) {
    const deck = window.decks && window.decks[String(deckId).toUpperCase()];
    if (!deck || !this.tracks.length) return;
    const current = deck.track || this.sel;
    let idx = current ? this.tracks.findIndex(t => t.id === current.id) : -1;
    if (idx < 0) idx = 0;
    let next = idx + dir;
    if (next < 0) next = this.tracks.length - 1;
    if (next >= this.tracks.length) next = 0;
    this.loadTo(this.tracks[next], deckId);
  },

  nextUnplayed(excludeId) {
    const pool = this.tracks.filter(t => !t.played && t.id !== excludeId);
    if (!pool.length) return null;
    let pick;
    if (this.shuffle) {
      pick = pool[Math.floor(Math.random() * pool.length)];
    } else {
      const anchor = this.tracks.findIndex(t => t.id === excludeId);
      const start = anchor >= 0 ? anchor + 1 : 0;
      for (let i = 0; i < this.tracks.length; i++) {
        const t = this.tracks[(start + i) % this.tracks.length];
        if (!t.played && t.id !== excludeId) { pick = t; break; }
      }
    }
    return pick || null;
  },

  // ---------- Marcas y opciones ----------
  markPlayed(track) {
    if (!track) return;
    track.played = true;
    this._writeMap();
    this.render();
  },

  togglePlayed(id) {
    const t = this.tracks.find(x => String(x.id) === String(id));
    if (!t) return;
    t.played = !t.played;
    this._writeMap();
    this.render();
  },

  clearMarks() {
    this.tracks.forEach(t => { t.played = false; });
    try { localStorage.removeItem(this.playedKey); } catch (_) { /* ignore */ }
    this.render();
    window.setStatus && window.setStatus('Marcas ✓ reiniciadas');
  },

  setHide(v) {
    this.hidePlayed = !!v;
    this.render();
  },

  setShuffle(v) { this.shuffle = !!v; },

  setAuto(v) {
    this.autoMode = !!v;
    const btn = $('#btn-auto');
    if (btn) btn.classList.toggle('active', this.autoMode);
    if (this.autoMode) {
      if (window.AutoMode) window.AutoMode.start(window.decks);
      window.setStatus && window.setStatus('AUTO activado');
    } else {
      if (window.AutoMode) window.AutoMode.stop();
      window.setStatus && window.setStatus('AUTO desactivado');
    }
  }
};

window.Library = Library;
if (typeof module !== 'undefined' && module.exports) module.exports = { Library };
