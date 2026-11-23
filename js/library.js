// library.js — Biblioteca: archivos reales, recordcases, filtro, marcas persistentes, arrastre y carga
'use strict';

if (typeof $ === 'undefined') {
  window.$ = (sel, r = document) => {
    const e = r.querySelector(sel);
    if (!e) console.error('Falta elemento en el HTML:', sel);
    return e;
  };
}

// Tokens en mayúsculas que pueden ser parte del nombre artístico (no código de descarga).
const TITLE_KEEP = new Set(['AC', 'DC', 'EP', 'LP', 'FM', 'AM', 'DJ', 'MC', 'II', 'III', 'IV']);

const Library = {
  tracks: [],
  folders: [],
  activeFolder: 'all',
  sel: null,
  autoMode: false,
  shuffle: false,
  hidePlayed: false,
  filterText: '',
  playedKey: 'hammer:played:v1',
  libKey: 'hammer:library:v1',
  _inited: false,
  _assignTarget: '',
  _storeTimer: null,

  // ---------- Init ----------
  init() {
    if (this._inited) return;
    this._inited = true;
    this._restore();
    this._bindUI();
    this._bindRecordcase();
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

    const clean = $('#btn-clean-titles');
    if (clean) clean.addEventListener('click', () => {
      // Con pista seleccionada: solo esa. Sin selección: toda la biblioteca.
      self.cleanTitles(self.sel || null);
    });

    // TODOS los botones de carga usan el mismo camino y arrancan el sonido.
    // Antes «→ A/B» sólo cargaban (deck READY en silencio) y sólo «▶→ A/B»
    // reproducían, que era una de las causas de «desde la playlist no suena».
    const loadA = $('#btn-load-a');
    const loadB = $('#btn-load-b');
    if (loadA) loadA.addEventListener('click', () => self.loadSelected('A', true));
    if (loadB) loadB.addEventListener('click', () => self.loadSelected('B', true));

    const playA = $('#btn-playload-a');
    const playB = $('#btn-playload-b');
    if (playA) playA.addEventListener('click', () => self.loadSelected('A', true));
    if (playB) playB.addEventListener('click', () => self.loadSelected('B', true));

    // Empezar de cero sin tocar los archivos del disco.
    const clearLib = $('#btn-clear-library');
    if (clearLib) clearLib.addEventListener('click', () => self.clearLibrary());

    const assignSel = $('#folder-assign');
    const assignBtn = $('#btn-folder-assign');
    if (assignSel) assignSel.addEventListener('change', () => { self._assignTarget = assignSel.value; });
    if (assignBtn) assignBtn.addEventListener('click', () => {
      if (!self._assignTarget) {
        window.setStatus && window.setStatus('Elige primero una carpeta de destino');
        return;
      }
      if (!self.sel) {
        window.setStatus && window.setStatus('Selecciona una pista primero');
        return;
      }
      self.assignToFolder(self.sel, self._assignTarget);
    });

    // Chips de recordcase: clic = filtrar, arrastrar una fila encima = asignar.
    const chips = $('#folder-chips');
    if (chips) {
      chips.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-folder]');
        if (chip) self.setActiveFolder(chip.dataset.folder);
      });
      chips.addEventListener('dragover', (e) => {
        const chip = e.target.closest('[data-folder]');
        if (!chip || chip.dataset.folder === 'all') return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        chip.classList.add('drop-hover');
      });
      chips.addEventListener('dragleave', (e) => {
        const chip = e.target.closest('[data-folder]');
        if (chip && (!e.relatedTarget || !chip.contains(e.relatedTarget))) chip.classList.remove('drop-hover');
      });
      chips.addEventListener('drop', (e) => {
        const chip = e.target.closest('[data-folder]');
        if (!chip || chip.dataset.folder === 'all') return;
        e.preventDefault();
        e.stopPropagation();
        chip.classList.remove('drop-hover');
        const id = e.dataTransfer && e.dataTransfer.getData('text/plain');
        const track = self.tracks.find(t => String(t.id) === String(id));
        if (track) self.assignToFolder(track, chip.dataset.folder);
      });
      // Clic derecho sobre una chip: menú propio de la app (crear / borrar).
      // El borrado real y su confirmación siguen en deleteFolder().
      chips.addEventListener('contextmenu', (e) => {
        const chip = e.target.closest('[data-folder]');
        if (!chip) return; // la zona vacía la abre el handler de .lib-header
        e.preventDefault();
        e.stopPropagation();
        self.showFolderContextMenu(e.clientX, e.clientY, chip.dataset.folder);
      });
    }

    // Tabla: clic = seleccionar, check = marcar, doble clic = cargar y reproducir, arrastre = cargar
    const tbody = $('#library-rows');
    if (tbody) {
      tbody.addEventListener('change', (e) => {
        const chk = e.target.closest('.chk-played');
        if (!chk) return;
        const row = chk.closest('tr');
        if (row) self.togglePlayed(Number(row.dataset.id));
      });
      tbody.addEventListener('click', (e) => {
        // Botonera flotante: se corta la propagación para que el clic en
        // Play A / Play B no dispare la selección ni la carga de la fila.
        const quick = e.target.closest('[data-quick-deck]');
        if (quick) {
          e.preventDefault();
          e.stopPropagation();
          const track = self._trackFromRow(quick.closest('tr'));
          if (track) self.loadTo(track, quick.dataset.quickDeck, true);
          self.hideContextMenu();
          return;
        }
        if (e.target.closest('.chk-played')) return;
        const row = e.target.closest('tr');
        if (!row) return;
        const track = self._trackFromRow(row);
        if (track) self.select(track);
      });
      tbody.addEventListener('dblclick', (e) => {
        if (e.target.closest('[data-quick-deck]')) { e.stopPropagation(); return; }
        if (e.target.closest('.chk-played')) return;
        const row = e.target.closest('tr');
        if (!row) return;
        const track = self._trackFromRow(row);
        if (!track) return;
        self.select(track);
        self.loadTo(track, self._preferredDeck(), true);
      });
      tbody.addEventListener('contextmenu', (e) => {
        const row = e.target.closest('tr');
        if (!row) return;
        const track = self._trackFromRow(row);
        if (!track) return;
        e.preventDefault();
        e.stopPropagation();
        self._ctxTrack = track;
        self.select(track);
        self.showContextMenu(e.clientX, e.clientY);
      });
      // El hover se refleja también con una clase para poder simularlo/probarlo
      // y para no depender sólo de :hover (p. ej. dispositivos táctiles).
      tbody.addEventListener('mouseover', (e) => {
        const row = e.target.closest('tr');
        if (!row) return;
        tbody.querySelectorAll('tr.row-hover').forEach(r => {
          if (r !== row) r.classList.remove('row-hover');
        });
        row.classList.add('row-hover');
      });
      tbody.addEventListener('mouseout', (e) => {
        const row = e.target.closest('tr');
        if (!row) return;
        const next = e.relatedTarget;
        if (!next || !row.contains(next)) row.classList.remove('row-hover');
      });
      tbody.addEventListener('dragstart', (e) => {
        const row = e.target.closest('tr');
        if (!row) return;
        const id = row.dataset.id;
        const track = self.tracks.find(t => String(t.id) === id) || null;

        // Guardamos la pista SIN llamar a select(): select() → render() →
        // tbody.innerHTML = ... destruiría la fila origen y el navegador
        // cancelaría el arrastre antes de poder soltarlo en un deck.
        self._dragTrack = track;
        self._dragId = String(id);
        if (row) row.classList.add('dragging');
        if (tbody) tbody.classList.add('dragging-active');

        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', String(id));
          e.dataTransfer.setData('application/x-hammer-track', String(id));
          e.dataTransfer.effectAllowed = 'copy';
        }
        // La clase .dragging da la pista visual sin repintar ni falsificar
        // la selección real (que se aplica al soltar, desde loadTo()).
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
    // Mientras se arrastra una fila, todos los decks se marcan como destinos
    // válidos (pista visual). El resalte fuerte se aplica al que esté debajo.
    document.addEventListener('dragstart', (e) => {
      const types = e.dataTransfer ? Array.from(e.dataTransfer.types || []) : [];
      if (types.includes('application/x-hammer-track') && app) app.classList.add('dragging-track');
    });

    const clearDrag = () => {
      if (self._stopDragAutoScroll) self._stopDragAutoScroll();
      if (app) {
        app.classList.remove('drag-over', 'dragging-track');
      }
      if (lib) lib.classList.remove('drag-over');
      if (tbody) tbody.classList.remove('dragging-active');
      document.querySelectorAll('tr.dragging').forEach(tr => tr.classList.remove('dragging'));
      document.querySelectorAll('.chip.drop-hover').forEach(c => c.classList.remove('drop-hover'));
      document.querySelectorAll('.drop-target.drag-over').forEach(el => el.classList.remove('drag-over'));
      self._dragTrack = null;
      self._dragId = '';
    };
    document.addEventListener('dragend', clearDrag);
    document.addEventListener('drop', clearDrag);
    // Cuando el puntero sale de la ventana durante un arrastre, dragend puede
    // no llegar: la señal de blur garantiza que no quede nada resaltado.
    window.addEventListener('blur', clearDrag);
    self._clearDrag = clearDrag;

    // Red de seguridad para arrastrar una FILA sobre un deck. El manejador
    // propio del panel (_bindPointerUI en deck.js) sigue siendo el principal,
    // pero en algunos navegadores el drop sobre un control hijo se pierde o
    // `dataTransfer.types` no expone los tipos propios durante el arrastre.
    // En captura vemos el evento de todos modos: primero nos aseguramos de que
    // el dragover sea aceptado (para que exista 'drop') y luego, si el destino
    // está dentro de un player, garantizamos carga + autoplay por el camino
    // único. Los archivos del explorador se dejan al manejador del deck.
    const rowDragOverDeck = (e) => {
      if (!e.target || !e.target.closest || !e.target.closest('.player')) return null;
      const dt = e.dataTransfer;
      const types = dt ? Array.from(dt.types || []) : [];
      const files = types.includes('Files') || !!(dt && dt.files && dt.files.length);
      const row = types.includes('application/x-hammer-track') ||
        types.includes('text/plain') || !!(self._dragTrack || self._dragId);
      return (!files && row) ? dt : null;
    };
    document.addEventListener('dragover', (e) => {
      const dt = rowDragOverDeck(e);
      if (!dt) return;
      e.preventDefault();
      dt.dropEffect = 'copy';
    }, true);
    document.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const types = dt ? Array.from(dt.types || []) : [];
      const files = types.includes('Files') || !!(dt && dt.files && dt.files.length);
      const row = types.includes('application/x-hammer-track') ||
        types.includes('text/plain') || !!(self._dragTrack || self._dragId);
      if (files || !row) return;
      const target = e.target && e.target.closest ? e.target.closest('.player') : null;
      if (!target) return;
      const deckId = target.id === 'player-b' ? 'B' : 'A';
      let id = '';
      try {
        id = (dt && (dt.getData('application/x-hammer-track') || dt.getData('text/plain'))) || '';
      } catch (_) { id = ''; }
      id = id || self._dragId || (self._dragTrack ? String(self._dragTrack.id) : '');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      self.dropTo(id, deckId, true);
    }, true);

    // El arrastre de una fila puede llevar el puntero fuera de la vista:
    // auto-scroll suave cerca de los bordes, sin capturar el puntero.
    this._bindDragAutoScroll();

    // Ctrl+V
    document.addEventListener('paste', (e) => {
      const files = e.clipboardData && e.clipboardData.files;
      if (files && files.length) {
        const added = self.add(files);
        if (added.length) window.setStatus && window.setStatus('Pegadas ' + added.length + ' pista(s)');
      }
    });

    this._bindContextMenu();
    this._bindFolderContextMenu();
  },

  // ---------- Auto-scroll durante el arrastre de filas ----------
  // Sólo se activa mientras se arrastra una pista de la biblioteca (tipo
  // 'application/x-hammer-track'). Escuchamos en fase de captura: los decks
  // y la biblioteca hacen stopPropagation() en su dragover, pero aquí seguimos
  // viendo el evento. No se llama a preventDefault ni se captura el puntero:
  // el movimiento vertical sigue siendo totalmente libre y el ratón nunca queda
  // atrapado al soltar cerca de un borde.
  _bindDragAutoScroll() {
    const self = this;
    const EDGE = 100;        // px de zona sensible junto al borde
    const MAX_SPEED = 22;    // px por frame justo en el borde
    const MIN_SPEED = 4;
    let raf = null;
    let x = 0;
    let y = 0;
    let active = false;

    const speed = (dist) => Math.ceil(
      MIN_SPEED + (1 - Math.max(0, dist) / EDGE) * (MAX_SPEED - MIN_SPEED));

    const step = () => {
      raf = null;
      if (!active || !self._dragTrack) return;
      const vh = window.innerHeight || document.documentElement.clientHeight || 768;
      const top = y >= 0 && y < EDGE;
      const bottom = y > vh - EDGE && y < vh;
      if (top || bottom) {
        const dir = top ? -1 : 1;
        const dist = top ? y : vh - y;
        const delta = dir * speed(dist);

        // Si el puntero está sobre la tabla y ésta todavía puede scrollear en
        // esa dirección, se mueve el contenedor; si no, se mueve la página.
        const table = $('.lib-table');
        const box = table && typeof table.getBoundingClientRect === 'function'
          ? table.getBoundingClientRect() : null;
        let movedContainer = false;
        if (box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
          const before = table.scrollTop;
          table.scrollTop += delta;
          movedContainer = table.scrollTop !== before;
        }
        if (!movedContainer && typeof window.scrollBy === 'function') {
          window.scrollBy(0, delta);
        }
      }
      if (active) raf = requestAnimationFrame(step);
    };

    const track = (e) => {
      if (e.clientX != null) x = e.clientX;
      if (e.clientY != null) y = e.clientY;
      const vh = window.innerHeight || document.documentElement.clientHeight || 768;
      active = !!self._dragTrack &&
        ((y >= 0 && y < EDGE) || (y > vh - EDGE && y < vh));
      if (active && raf === null) raf = requestAnimationFrame(step);
      if (!active && raf !== null) { cancelAnimationFrame(raf); raf = null; }
    };

    const stop = () => {
      active = false;
      if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    };

    document.addEventListener('dragover', track, { capture: true });
    // Al scrollear, el elemento bajo el puntero cambia y pueden llegar
    // dragenter/dragleave; dragenter lo rearma para no perder el borde.
    document.addEventListener('dragenter', track, { capture: true });
    // dragover deja de llegar cuando el puntero sale de la ventana: estas
    // señales garantizan que no sigamos scrolleando "a ciegas".
    document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) stop(); }, true);
    document.addEventListener('drop', stop, true);
    document.addEventListener('dragend', stop, true);
    window.addEventListener('blur', stop);
    self._stopDragAutoScroll = stop;
  },

  // ---------- Persistencia ----------
  // Guardamos SOLO metadatos. Las URL blob: caducan al recargar, por eso jamás
  // se escriben en localStorage: al volver a añadir el archivo se regeneran.
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

  // Los cambios de TRIM llegan desde un fader: agrupamos escrituras para no
  // serializar la biblioteca en cada evento 'input' de la rueda del ratón.
  _scheduleStore() {
    if (this._storeTimer) clearTimeout(this._storeTimer);
    this._storeTimer = setTimeout(() => {
      this._storeTimer = null;
      this._writeStore();
    }, 150);
  },

  _writeStore() {
    try {
      if (this._storeTimer) { clearTimeout(this._storeTimer); this._storeTimer = null; }
      const data = {
        folders: this.folders.map(f => ({ id: String(f.id), name: f.name })),
        activeFolder: String(this.activeFolder),
        tracks: this.tracks.map(t => ({
          id: t.id,
          key: this._key(t),
          name: t.name, title: t.title, artist: t.artist,
          size: t.size, lastModified: t.lastModified,
          version: t.version, comment: t.comment, bpm: t.bpm,
          trimDb: t.trimDb, folder: t.folder, played: !!t.played
        }))
      };
      localStorage.setItem(this.libKey, JSON.stringify(data));
    } catch (_) { /* ignore: cuota o almacenamiento desactivado */ }
  },

  _writeMap() {
    const map = {};
    this.tracks.forEach(t => { map[this._key(t)] = !!t.played; });
    try { localStorage.setItem(this.playedKey, JSON.stringify(map)); } catch (_) { /* ignore */ }
    this._writeStore();
  },

  _restore() {
    let data = null;
    try {
      const raw = localStorage.getItem(this.libKey);
      if (raw) data = JSON.parse(raw);
    } catch (_) { data = null; }
    if (!data || typeof data !== 'object') data = {};

    const folders = Array.isArray(data.folders)
      ? data.folders.filter(f => f && f.id && f.name).map(f => ({ id: String(f.id), name: String(f.name) }))
      : [];
    this.folders = folders.length ? folders : [{ id: 'default', name: 'Default' }];
    if (!this.folders.some(f => f.id === 'default')) this.folders.unshift({ id: 'default', name: 'Default' });
    const ids = new Set(this.folders.map(f => f.id));

    const played = this._readMap();
    const seen = new Set();
    this.tracks = (Array.isArray(data.tracks) ? data.tracks : []).map(t => {
      if (!t) return null;
      const key = t.key || [t.name, t.size, t.lastModified].join('|');
      if (seen.has(key)) return null;
      seen.add(key);
      const track = {
        id: t.id != null ? t.id : Date.now() + Math.random(),
        name: t.name || 'pista',
        title: t.title || t.name || 'pista',
        artist: t.artist || '',
        url: null,                       // se regenera al re-añadir el MP3
        missing: true,                   // sin archivo enlazado en esta sesión
        dur: null,
        size: t.size || 0,
        lastModified: t.lastModified || 0,
        version: t.version || '',
        comment: t.comment || '',
        bpm: t.bpm || '---',
        folder: ids.has(String(t.folder)) ? String(t.folder) : 'default',
        played: typeof t.played === 'boolean' ? t.played : !!played[key]
      };
      // Solo si venía guardado: las pistas sin preferencia conservan el TRIM
      // actual del deck al cargarlas, como en una mesa real.
      if (typeof t.trimDb === 'number' && Number.isFinite(t.trimDb)) {
        track.trimDb = Math.max(-12, Math.min(12, t.trimDb));
      }
      return track;
    }).filter(Boolean);

    const restoredActive = String(data.activeFolder);
    this.activeFolder = (restoredActive === 'all' || ids.has(restoredActive)) ? restoredActive : 'all';
  },

  // ---------- Archivos ----------
  // Nombre de IDENTIDAD: no se toca. Es la base de la clave
  // name|size|lastModified que permite re-enlazar el MP3 tras recargar.
  _cleanName(f) {
    return (f.name || 'pista')
      .replace(/\.[^.]+$/, '')
      .replace(/^SpotiDown\.App\s*-\s*/i, '');
  },

  // Limpieza solo de LECTURA (title/artist): sufijos típicos de descarga
  // (_3jsRecKTSRw, _vyc0eT8t_QU, -xY7aBc0123...), guiones bajos y espacios
  // redundantes. Jamás modifica name/size/fecha/url ni el archivo en disco.
  _cleanTitle(name) {
    let out = String(name || '').replace(/^SpotiDown\.App\s*-\s*/i, '');

    let stripped = true;
    while (stripped) {
      stripped = false;
      const m = out.match(/[_-]([A-Za-z0-9]{2,})$/);
      if (!m) break;
      const token = m[1];
      // Un código lleva dígitos mezclados con letras (3jsRecKTSRw,
      // vyc0eT8t), es numérico largo (2020) o un sufijo corto en mayúsculas
      // (QU, HQ). Una palabra normal como "Cancion" NO se toca.
      const looksCode = (/\d/.test(token) && /[A-Za-z]/.test(token)) ||
        /\d{3,}/.test(token) ||
        (/^[A-Z]{2,4}$/.test(token) && !TITLE_KEEP.has(token));
      if (!looksCode) break;
      out = out.slice(0, m.index);
      stripped = true;
    }

    return out.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  },

  add(files) {
    const list = Array.from(files || []).filter(f =>
      (f.type && f.type.startsWith('audio/')) ||
      /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus)$/i.test(f.name || '')
    );
    const map = this._readMap();
    const added = [];
    let relinked = 0;

    list.forEach(f => {
      const name = this._cleanName(f);
      const key = [name, f.size, f.lastModified].join('|');
      const existing = this.tracks.find(t => this._key(t) === key);

      if (existing) {
        // Re-vinculación: el archivo físico vuelve a estar disponible.
        // No revocamos la URL si algún deck la está usando todavía.
        const inUse = ['A', 'B'].some(k => {
          const d = window.decks && window.decks[k];
          return d && d.audio && d.audio.src === existing.url;
        });
        if (!inUse && existing.url && String(existing.url).indexOf('blob:') === 0) {
          try { URL.revokeObjectURL(existing.url); } catch (_) { /* ignore */ }
        }
        existing.url = URL.createObjectURL(f);
        if (existing.missing) relinked++;
        existing.missing = false;
        existing.name = name;
        added.push(existing);
        return;
      }

      const display = this._cleanTitle(name);
      const sep = display.lastIndexOf(' - ');
      const title = sep > 0 ? display.slice(0, sep).trim() : display.trim();
      const artist = sep > 0 ? display.slice(sep + 3).trim() : '';
      const track = {
        id: Date.now() + Math.random(),
        name, title, artist,
        url: URL.createObjectURL(f),
        missing: false,
        dur: null,
        size: f.size,
        lastModified: f.lastModified,
        version: '',
        comment: '',
        bpm: '---',
        folder: this.activeFolder !== 'all' ? this.activeFolder : 'default',
        played: !!map[key]
      };
      this.tracks.push(track);
      added.push(track);
    });

    if (added.length) {
      if (!this.sel) this.sel = added[0]; // para que → A / → B funcionen nada más añadir
      this._writeMap();
      this.render();
      window.setStatus && window.setStatus('Añadidas ' + added.length + ' pista(s)' +
        (relinked ? ' · ' + relinked + ' re-enlazada(s)' : ''));
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

  // ---------- TRIM por pista / limpieza de títulos ----------
  setTrackTrim(track, db) {
    if (!track) return;
    const v = Math.max(-12, Math.min(12, Number(db) || 0));
    if (track.trimDb === v) return;
    track.trimDb = v;   // metadato: la URL blob: jamás entra en _writeStore()
    this._scheduleStore();
  },

  // Aplica _cleanTitle a una pista (o a todas) sin tocar la identidad del
  // archivo: name, size, lastModified y url quedan intactos.
  cleanTitles(track) {
    const targets = track ? [track] : this.tracks;
    let changed = 0;
    targets.forEach(t => {
      const display = this._cleanTitle(t.name);
      const sep = display.lastIndexOf(' - ');
      const title = sep > 0 ? display.slice(0, sep).trim() : display.trim();
      const artist = sep > 0 ? display.slice(sep + 3).trim() : '';
      if (t.title !== title || t.artist !== artist) {
        t.title = title;
        t.artist = artist;
        changed++;
      }
    });
    if (changed) {
      this._writeStore();
      this.render();
    }
    window.setStatus && window.setStatus(changed
      ? 'Títulos limpios: ' + changed + ' pista(s) · archivo intacto'
      : 'Los títulos ya estaban limpios');
    return changed;
  },

  // ---------- Recordcases ----------
  _pool() {
    if (this.activeFolder === 'all') return this.tracks;
    return this.tracks.filter(t => String(t.folder) === String(this.activeFolder));
  },

  folderName(id) {
    const f = this.folders.find(x => String(x.id) === String(id));
    return f ? f.name : '—';
  },

  setActiveFolder(id) {
    this.activeFolder = (id === 'all') ? 'all' : String(id);
    this._writeMap();
    this.render();
    window.setStatus && window.setStatus('Recordcase: ' + (id === 'all' ? 'Todas' : this.folderName(id)));
  },

  assignToFolder(track, folderId) {
    if (!track) return false;
    const id = String(folderId);
    if (!this.folders.some(f => f.id === id)) return false;
    track.folder = id;
    this._writeMap();
    this.render();
    window.setStatus && window.setStatus('«' + track.title + '» → ' + this.folderName(id));
    return true;
  },

  createFolder(name) {
    name = String(name || '').trim();
    if (!name) return null;
    if (this.folders.some(f => f.name.toLowerCase() === name.toLowerCase())) {
      window.setStatus && window.setStatus('Ya existe una carpeta con ese nombre');
      return null;
    }
    const f = { id: 'f' + Date.now() + Math.floor(Math.random() * 1000), name: name };
    this.folders.push(f);
    this._writeMap();
    this.render();
    this._renderRecordcaseList();
    return f;
  },

  // Creación ágil desde el menú contextual (chip o barra): nombre directo y,
  // si no se puede preguntar o se dejó vacío, el diálogo de recordcases.
  _promptNewFolder() {
    let answer = null;
    if (typeof window.prompt === 'function') {
      try { answer = window.prompt('Nombre de la nueva recordcase:'); } catch (_) { answer = null; }
    }
    if (answer === null) return; // cancelado
    const name = String(answer).trim();
    if (name) {
      const f = this.createFolder(name);
      if (f) this.setActiveFolder(f.id);
    } else if (this._openRecordcase) {
      this._openRecordcase(true);
    }
  },

  renameFolder(id, name) {
    name = String(name || '').trim();
    const f = this.folders.find(x => String(x.id) === String(id));
    if (!f || !name) return false;
    if (id !== 'default' && this.folders.some(x => x.id !== f.id && x.name.toLowerCase() === name.toLowerCase())) {
      window.setStatus && window.setStatus('Ya existe una carpeta con ese nombre');
      this._renderRecordcaseList();
      return false;
    }
    f.name = name;
    this._writeMap();
    this.render();
    this._renderRecordcaseList();
    return true;
  },

  // Las carpetas base ('all' = Todas y 'default') son del sistema: nunca se
  // pueden borrar. Las demás piden confirmación y sus pistas se reasignan a
  // Default, sin tocar archivos ni URLs (el store sigue siendo sólo metadatos).
  deleteFolder(id, opts = {}) {
    const key = String(id);
    const f = this.folders.find(x => String(x.id) === key);
    const system = key === 'all' || key === 'default' ||
      (f && String(f.id) === 'all');
    if (system || key === 'undefined' || !f) {
      window.setStatus && window.setStatus(
        system ? '«Todas» y «Default» son carpetas del sistema y no se pueden borrar'
               : 'No se encontró esa carpeta');
      return false;
    }
    if (!opts.skipConfirm && typeof window.confirm === 'function') {
      const n = this.tracks.filter(t => String(t.folder) === key).length;
      const dest = this.folderName('default') || 'Default';
      const msg = '¿Borrar la recordcase «' + f.name + '»?\n\n' +
        (n ? n + ' pista(s) pasarán a «' + dest + '». ' : '') +
        'Tus archivos de audio no se borran.';
      if (!window.confirm(msg)) {
        window.setStatus && window.setStatus('Borrado cancelado');
        return false;
      }
    }
    this.folders = this.folders.filter(x => String(x.id) !== key);
    this.tracks.forEach(t => { if (String(t.folder) === key) t.folder = 'default'; });
    if (String(this.activeFolder) === key) this.activeFolder = 'default';
    if (String(this._assignTarget) === key) this._assignTarget = '';
    this._writeMap();
    this.render();
    this._renderRecordcaseList();
    window.setStatus && window.setStatus('Carpeta «' + f.name + '» borrada · sus pistas pasan a ' + this.folderName('default'));
    return true;
  },

  _bindRecordcase() {
    const self = this;
    const dlg = $('#dlg-recordcase');
    const open = (focusNew) => {
      self._renderRecordcaseList();
      if (dlg && !dlg.open && typeof dlg.showModal === 'function') dlg.showModal();
      if (focusNew) {
        const name = $('#rc-new-name');
        if (name && typeof name.focus === 'function') name.focus();
      }
    };
    self._openRecordcase = open;
    const newBtn = $('#btn-folder-new');
    const editBtn = $('#btn-folder-edit');
    if (newBtn) newBtn.addEventListener('click', () => open(true));
    if (editBtn) editBtn.addEventListener('click', () => open(false));

    const input = $('#rc-new-name');
    const doAdd = () => {
      const f = self.createFolder(input ? input.value : '');
      if (f) {
        if (input) input.value = '';
        self.setActiveFolder(f.id);
      }
    };
    const addBtn = $('#rc-add');
    if (addBtn) addBtn.addEventListener('click', doAdd);
    if (input) input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doAdd(); }
    });

    const list = $('#rc-list');
    if (list) {
      list.addEventListener('change', (e) => {
        const inp = e.target.closest('[data-rc-id]');
        if (inp) self.renameFolder(inp.dataset.rcId, inp.value);
      });
      list.addEventListener('click', (e) => {
        const del = e.target.closest('[data-rc-del]');
        if (del) self.deleteFolder(del.dataset.rcDel);
      });
    }
  },

  _renderRecordcaseList() {
    const list = $('#rc-list');
    if (!list) return;
    list.innerHTML = this.folders.map(f => {
      const n = this.tracks.filter(t => String(t.folder) === String(f.id)).length;
      const label = String(f.id) === 'default' ? ' (fija)' : '';
      return '<div class="rc-row">' +
        '<input type="text" data-rc-id="' + this._esc(f.id) + '" value="' + this._esc(f.name) + '" maxlength="40" aria-label="Nombre de carpeta">' +
        '<span class="rc-count">' + n + ' pista(s)' + label + '</span>' +
        (String(f.id) === 'default' ? '<span class="rc-count">base</span>'
          : '<button type="button" class="danger" data-rc-del="' + this._esc(f.id) +
            '" title="Borrar carpeta (pide confirmación; sus pistas van a Default)">✕ Borrar</button>') +
        '</div>';
    }).join('');
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
    this._pool().forEach(t => {
      const matches = !q ||
        String(t.title || '').toLowerCase().includes(q) ||
        String(t.artist || '').toLowerCase().includes(q) ||
        String(t.name || '').toLowerCase().includes(q) ||
        this.folderName(t.folder).toLowerCase().includes(q);
      if (!matches) return;
      if (this.hidePlayed && t.played) return;
      visible++;
      const cls = [t === this.sel ? 'sel' : '', t.played ? 'played' : '',
        t.missing ? 'missing' : ''].filter(Boolean).join(' ');
      const tip = t.missing ? ' · vuelve a añadir el archivo' : '';
      html += '<tr draggable="true" data-id="' + this._esc(t.id) + '" class="' + cls + '">' +
        '<td><input type="checkbox" class="chk-played" ' + (t.played ? 'checked' : '') + ' aria-label="Marcar reproducida"></td>' +
        '<td>' + this._esc(t.bpm || '---') + '</td>' +
        '<td title="' + this._esc(t.artist + tip) + '">' + this._esc(t.artist) + '</td>' +
        '<td title="' + this._esc(t.title + tip) + '">' + this._esc(t.title) + '</td>' +
        '<td>' + this._esc(t.version) + '</td>' +
        '<td class="comment-cell"><div class="comment-inner">' +
          '<span class="comment-text" title="' + this._esc(t.comment + tip) + '">' + this._esc(t.comment) + '</span>' +
          '<span class="row-quick">' +
            '<button type="button" class="quick-btn quick-a" data-quick-deck="A" title="Cargar y reproducir en Player A">Play A</button>' +
            '<button type="button" class="quick-btn quick-b" data-quick-deck="B" title="Cargar y reproducir en Player B">Play B</button>' +
          '</span>' +
        '</div></td>' +
        '</tr>';
    });

    tbody.innerHTML = html;
    if (empty) {
      empty.textContent = this.tracks.length
        ? 'Sin pistas en esta vista · cambia de carpeta o quita el filtro'
        : 'Arrastra aquí tus MP3 o pulsa «+ Añadir MP3»';
      empty.style.display = visible ? 'none' : 'grid';
    }
    const count = $('#track-count');
    if (count) count.textContent = String(this.tracks.length);
    this._renderChips();
  },

  _renderChips() {
    const bar = $('#folder-chips');
    if (bar) {
      const active = String(this.activeFolder);
      const baseTip = 'Clic = filtrar por recordcase';
      let html = '<button type="button" class="chip' + (active === 'all' ? ' active' : '') +
        '" data-folder="all" title="' + baseTip + ' (carpeta base)">Todas<span class="chip-count">' +
        this.tracks.length + '</span></button>';
      this.folders.forEach(f => {
        const id = String(f.id);
        const n = this.tracks.filter(t => String(t.folder) === id).length;
        const tip = (id === 'default') ? baseTip + ' (carpeta base)'
          : baseTip + ' · clic derecho = borrar carpeta';
        html += '<button type="button" class="chip' + (active === id ? ' active' : '') +
          '" data-folder="' + this._esc(id) + '" title="' + tip + '">' + this._esc(f.name) +
          '<span class="chip-count">' + n + '</span></button>';
      });
      bar.innerHTML = html;
    }
    const name = $('#lib-folder-name');
    if (name) name.textContent = this.activeFolder === 'all' ? 'Todas' : this.folderName(this.activeFolder);
    const sel = $('#folder-assign');
    if (sel) {
      const prev = this._assignTarget || '';
      sel.innerHTML = '<option value="">Mover a carpeta…</option>' + this.folders.map(f =>
        '<option value="' + this._esc(f.id) + '">' + this._esc(f.name) + '</option>').join('');
      sel.value = prev;
      if (sel.value !== prev) { sel.value = ''; this._assignTarget = ''; }
    }
  },

  // ---------- Menú contextual de asignación rápida ----------
  _bindContextMenu() {
    const self = this;
    const menu = $('#track-ctx-menu');
    if (!menu) return;
    this._ctxMenu = menu;

    menu.addEventListener('click', (e) => {
      const cleanItem = e.target.closest('[data-ctx-clean]');
      if (cleanItem && menu.contains(cleanItem)) {
        e.preventDefault();
        e.stopPropagation();
        const track = self._ctxTrack;
        self.hideContextMenu();
        if (track) self.cleanTitles(track);
        return;
      }
      const folderItem = e.target.closest('[data-ctx-folder]');
      if (folderItem && menu.contains(folderItem)) {
        e.preventDefault();
        e.stopPropagation();
        const track = self._ctxTrack;
        const id = folderItem.getAttribute('data-ctx-folder');
        self.hideContextMenu();
        if (track) self.assignToFolder(track, id);
        return;
      }
      const item = e.target.closest('[data-ctx-deck]');
      if (!item || !menu.contains(item)) return;
      e.preventDefault();
      e.stopPropagation();
      // El menú puede cerrarse (blur, scroll, clic fuera) entre la apertura y
      // el clic: la fila también quedó seleccionada en el contextmenu, así que
      // la pista se resuelve igual aunque _ctxTrack ya se haya limpiado.
      const track = self._ctxTrack || self.sel;
      const deck = item.getAttribute('data-ctx-deck');
      const autoplay = item.getAttribute('data-ctx-play') === '1';
      self.hideContextMenu();
      if (track) self.loadTo(track, deck, autoplay);
    });

    // Cierre automático: clic fuera (capture, así no se pierde ningún clic),
    // Escape, scroll de la tabla, resize o pérdida de foco de la ventana.
    document.addEventListener('click', (e) => {
      if (!menu.classList.contains('open')) return;
      if (e.target === menu || menu.contains(e.target)) return;
      self.hideContextMenu();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') self.hideContextMenu();
    });
    const table = $('.lib-table');
    if (table) table.addEventListener('scroll', () => self.hideContextMenu(), { passive: true });
    window.addEventListener('resize', () => self.hideContextMenu());
    window.addEventListener('blur', () => self.hideContextMenu());
  },

  // Coloca cualquier menú de la app junto al cursor, dejando siempre un margen
  // y evitando que se salga de la ventana (z-index alto, no queda tapado).
  _positionMenu(menu, clientX, clientY) {
    menu.classList.add('open');
    menu.setAttribute('aria-hidden', 'false');

    // Medimos ya visible para conocer su tamaño real; fallback para entornos
    // sin layout (p. ej. DOM simulado) o antes de que se aplique la hoja de estilos.
    const rect = typeof menu.getBoundingClientRect === 'function'
      ? menu.getBoundingClientRect() : null;
    const w = (rect && rect.width) || menu.offsetWidth || 226;
    const h = (rect && rect.height) || menu.offsetHeight || 132;
    const pad = 6;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    let left = Number(clientX) || 0;
    let top = Number(clientY) || 0;
    if (left + w > vw - pad) left = vw - w - pad;
    if (top + h > vh - pad) top = vh - h - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  },

  showContextMenu(clientX, clientY) {
    const menu = this._ctxMenu;
    if (!menu) return;
    if (this._folderMenu) this.hideFolderContextMenu();
    this._renderCtxFolders();
    this._positionMenu(menu, clientX, clientY);
  },

  _renderCtxFolders() {
    const box = $('#ctx-folders');
    if (!box) return;
    if (!this._ctxTrack) { box.innerHTML = '<div class="ctx-empty">—</div>'; return; }
    box.innerHTML = this.folders.map(f =>
      '<button type="button" role="menuitem" data-ctx-folder="' + this._esc(f.id) + '">' +
      this._esc(f.name) + '</button>').join('');
  },

  hideContextMenu() {
    const menu = this._ctxMenu;
    if (!menu) return;
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
    this._ctxTrack = null;
  },

  // ---------- Menú contextual de recordcases ----------
  _bindFolderContextMenu() {
    const self = this;
    const menu = $('#folder-ctx-menu');
    if (!menu) return;
    this._folderMenu = menu;

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-folder-ctx]');
      if (!item || !menu.contains(item)) return;
      e.preventDefault();
      e.stopPropagation();
      const action = item.getAttribute('data-folder-ctx');
      const id = self._folderCtxId;
      self.hideFolderContextMenu();
      if (action === 'new') {
        self._promptNewFolder();
      } else if (action === 'delete' && id) {
        self.deleteFolder(id); // confirmación + reasignación a Default
      } else if (action === 'clear') {
        self.clearLibrary();   // confirmación; NO borra archivos del disco
      }
    });

    // Cierre: clic fuera (capture), Escape, scroll, resize y pérdida de foco.
    document.addEventListener('click', (e) => {
      if (!menu.classList.contains('open')) return;
      if (e.target === menu || menu.contains(e.target)) return;
      self.hideFolderContextMenu();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') self.hideFolderContextMenu();
    });
    const table = $('.lib-table');
    if (table) table.addEventListener('scroll', () => self.hideFolderContextMenu(), { passive: true });
    window.addEventListener('resize', () => self.hideFolderContextMenu());
    window.addEventListener('blur', () => self.hideFolderContextMenu());

    // Zona de biblioteca / barra de carpetas: menú propio, nunca el del
    // navegador. Las filas de pista abren el suyo y paran la propagación.
    const header = $('.lib-header');
    if (header) header.addEventListener('contextmenu', (e) => {
      if (e.target.closest('[data-folder]')) return; // ya lo abre la chip
      e.preventDefault();
      e.stopPropagation();
      self.showFolderContextMenu(e.clientX, e.clientY, '');
    });
    const library = $('.library');
    if (library && library !== header) library.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      self.showFolderContextMenu(e.clientX, e.clientY, '');
    });
  },

  showFolderContextMenu(clientX, clientY, id) {
    const menu = this._folderMenu;
    if (!menu) return;
    if (this._ctxMenu) this.hideContextMenu();
    const key = String(id || '');
    const system = key === 'all' || key === 'default';
    const folder = this.folders.find(f => String(f.id) === key && !system);
    this._folderCtxId = folder ? key : '';

    const del = menu.querySelector('[data-folder-ctx="delete"]');
    if (del) del.hidden = !folder;
    const title = $('#folder-ctx-title');
    if (title) title.textContent = folder ? folder.name.toUpperCase() : 'RECORDCASES';
    this._positionMenu(menu, clientX, clientY);
  },

  hideFolderContextMenu() {
    const menu = this._folderMenu;
    if (!menu) return;
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
    this._folderCtxId = '';
  },

  _trackFromRow(row) {
    if (!row || !row.dataset) return null;
    return this.tracks.find(t => String(t.id) === row.dataset.id) || null;
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

  // Punto de entrada ÚNICO para cualquier carga: LCD, doble clic, botones,
  // menú contextual, arrastre y navegación de pistas. Lo único que cambia es
  // el deck de destino y si se pide reproducción (por defecto, sí).
  loadTo(track, deckId, autoplay = true) {
    if (!track) return false;
    const key = String(deckId || 'A').toUpperCase();
    const deck = window.decks && window.decks[key];
    this.select(track);
    if (!track.url) {
      // Pista restaurada de localStorage: aviso claro en LCD, barra y consola.
      // Nunca finjimos un PLAY: no hay archivo enlazado en esta sesión, pero
      // el deck queda intacto (ni LOADING colgado ni errores en consola).
      const title = track.title || track.name || 'pista';
      if (deck && typeof deck.notifyMissing === 'function') deck.notifyMissing(track);
      else {
        if (deck && typeof deck.showMessage === 'function') {
          deck.showMessage('⚠ SIN ARCHIVO · vuelve a añadir el MP3 o arrastra el archivo');
        }
        window.setStatus && window.setStatus('⚠ «' + title +
          '»: vuelve a añadir el MP3 o arrástralo al deck para enlazarlo');
      }
      return false;
    }
    if (!deck) return false;
    // Soltar/cargar es un gesto del usuario: reanudamos el AudioContext aquí,
    // de forma síncrona, para que el play() posterior no se quede bloqueado.
    // Deck.load()/play() vuelven a hacerlo por su cuenta: es idempotente.
    if (deck && typeof deck._resumeCtx === 'function') deck._resumeCtx();
    if (window.ctx && window.ctx.state === 'suspended' && typeof window.ctx.resume === 'function') {
      try { window.ctx.resume(); } catch (_) { /* ignore */ }
    }
    const name = track.title || track.name || 'pista';
    const requested = deck.load(track, !!autoplay);
    window.setStatus && window.setStatus(name + ' → Player ' + key + ' · cargando…');

    // Antes se escribía «· PLAY» aquí mismo, aunque el archivo estuviera
    // roto o el autoplay bloqueado. Ahora el estado final llega del resultado
    // real de load()/play() (que también actualizan LCD y consola al fallar).
    if (requested && typeof requested.then === 'function') {
      requested.then((ok) => {
        if (!ok) return; // load/play ya informaron del error
        const gain = window.getXfGain ? window.getXfGain(key) : 1;
        const masterLevel = window.masterGain ? window.masterGain.gain.value
          : (window.getMaster ? window.getMaster() : 1);
        if (gain < 0.03 || masterLevel <= 0.001) {
          window.setStatus && window.setStatus(
            '⚠ «' + name + '» cargada pero silenciada: revisa CROSSFADER / MASTER / STANDBY');
        } else if (!autoplay) {
          window.setStatus && window.setStatus(name + ' → Player ' + key + ' · listo');
        }
        // Con autoplay, onDeckPlay() ya escribió «▶ … · pinchados N».
      }).catch((err) => {
        console.error('[hammer] Library.loadTo: fallo inesperado al cargar «' + name + '»', err);
        window.setStatus && window.setStatus('⚠ No se pudo cargar «' + name + '» en Player ' + key);
      });
    }
    return true;
  },

  // Punto de entrada único para un soltar desde una fila. Usa la referencia
  // guardada en dragstart (la tabla se repinta al cargar, pero ya terminó el
  // arrastre) y delega en loadTo(), que avisa si la pista está sin enlazar.
  // autoplay = true al soltar sobre un deck (o al usar «▶→ A/B»).
  dropTo(id, deckId, autoplay = true) {
    let track = null;
    if (id && typeof id === 'object') {
      // Llamada directa con el objeto pista (p. ej. desde la LCD).
      track = id;
    } else {
      const key = String(id == null || id === '' ? (this._dragId || '') : id);
      // _dragTrack es la referencia viva capturada en dragstart: sobrevive a
      // cualquier repintado de la tabla. Si no está, buscamos por id.
      track = (this._dragTrack && String(this._dragTrack.id) === key)
        ? this._dragTrack
        : this.tracks.find(t => String(t.id) === key) || null;
    }
    if (this._clearDrag) this._clearDrag();
    return this.loadTo(track, deckId, !!autoplay);
  },

  loadSelected(deckId, autoplay = true) {
    if (!this.sel) {
      window.setStatus && window.setStatus('Selecciona una pista primero');
      return false;
    }
    return this.loadTo(this.sel, deckId, !!autoplay);
  },

  loadAdjacent(deckId, dir) {
    const deck = window.decks && window.decks[String(deckId).toUpperCase()];
    if (!deck || !this.tracks.length) return;
    const pool = this._pool();
    const current = deck.track || this.sel;
    let idx = current ? pool.findIndex(t => t.id === current.id) : -1;
    if (idx < 0) idx = 0;
    let next = idx + dir;
    if (next < 0) next = pool.length - 1;
    if (next >= pool.length) next = 0;
    if (pool[next]) this.loadTo(pool[next], deckId, true);
  },

  nextUnplayed(excludeId) {
    const pool = this._pool().filter(t => !t.played && t.id !== excludeId);
    if (!pool.length) return null;
    let pick;
    if (this.shuffle) {
      pick = pool[Math.floor(Math.random() * pool.length)];
    } else {
      const anchor = this._pool().findIndex(t => t.id === excludeId);
      const source = this._pool();
      const start = anchor >= 0 ? anchor + 1 : 0;
      for (let i = 0; i < source.length; i++) {
        const t = source[(start + i) % source.length];
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
    this._writeStore();
    this.render();
    window.setStatus && window.setStatus('Marcas ✓ reiniciadas · el reloj de sesión sigue');
  },

  // «Vaciar biblioteca» ≠ «Reiniciar ✓» ≠ «↺ sesión». Sólo limpia los
  // metadatos de la app para empezar de cero: los MP3 del disco no se tocan,
  // hammer:master y hammer:skin se conservan y Session no se modifica.
  clearLibrary() {
    const n = this.tracks.length;
    const custom = this.folders.filter(f => String(f.id) !== 'default').length;
    if (!n && !custom) {
      window.setStatus && window.setStatus('La biblioteca ya está vacía');
      return false;
    }
    const msg = '¿Vaciar la biblioteca?\n\n' +
      'Se quitarán ' + n + ' pista(s) y ' + custom + ' carpeta(s) personalizada(s) de la app.\n' +
      'Tus archivos de audio en el disco NO se borran.\n' +
      'El reloj de sesión y las marcas ✓ no se reinician con esta acción.';
    if (typeof window.confirm === 'function' && !window.confirm(msg)) {
      window.setStatus && window.setStatus('Limpieza cancelada · biblioteca intacta');
      return false;
    }

    // AUTO se apaga: su cola venía de la biblioteca que acabamos de vaciar.
    if (this.autoMode) this.setAuto(false);

    // Expulsar primero para no dejar sonando ni con src una pista que se va.
    ['A', 'B'].forEach(k => {
      const d = window.decks && window.decks[k];
      if (d && typeof d.eject === 'function') d.eject();
    });
    // Revocar las URLs blob: de esta sesión (jamás se escribieron en localStorage).
    this.tracks.forEach(t => {
      if (t.url && String(t.url).indexOf('blob:') === 0) {
        try { URL.revokeObjectURL(t.url); } catch (_) { /* ignore */ }
      }
    });

    this.tracks = [];
    this.folders = [{ id: 'default', name: 'Default' }];
    this.activeFolder = 'all';
    this.sel = null;
    this._ctxTrack = null;
    this._assignTarget = '';
    try { localStorage.removeItem(this.playedKey); } catch (_) { /* ignore */ }
    try { localStorage.removeItem(this.libKey); } catch (_) { /* ignore */ }
    this.render();
    this._renderRecordcaseList();
    window.setStatus && window.setStatus('Biblioteca vacía · los archivos del disco siguen intactos');
    return true;
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
