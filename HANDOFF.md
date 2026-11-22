# HANDOFF — dj. hammer

Guía de relevo para continuar el desarrollo. Todo lo descrito corresponde al código tal como está en `main` tras la etiqueta `Silver-DjHammer`.

---

## 1. Estado actual

| Concepto | Valor |
|---|---|
| Rama | `main` |
| Commit HEAD | `39ac1816cc883522c5d4ba0f3235aa39080abd16` (`feat(dj-hammer): recordcases, session clock/counter, track details and FX rack`) |
| Etiqueta actual | `Silver-DjHammer` (etiqueta anotada `8bcbfd1`, apunta a `39ac181`) |
| Remote | `origin` → <https://github.com/martillohamer/hamer-sound.git>, `origin/main` en `39ac181` |
| Árbol de trabajo | Limpio al redactar esta guía; `README.md` y `HANDOFF.md` quedan como archivos nuevos pendientes de revisar/commitear |
| Dependencias | Ninguna: HTML + CSS + JS vanilla, sin build |

### Hitos

| Etiqueta | Objeto tag | Commit | Fecha (creación tag) | Qué se estrenó |
|---|---|---|---|---|
| `mixer-finish` | `c817666` | `384ea32` | 2026-11-22 19:05:52 +0100 | Controles de deck, carga de audio e interacción con ratón |
| `Dj-Opa` | `3faa344` | `6205201` | 2026-11-22 20:32:36 +0100 | Botones hover `Play A/B` y menú contextual de pistas |
| `Silver-DjHammer` | `8bcbfd1` | `39ac181` | 2026-11-22 21:27:34 +0100 | Recordcases, reloj/contador de sesión, ficha de pista y rack FX |

Historial anterior: `3e9ea1f` (primer commit) → `5151964` (`chore: eliminar app.js y files.zip`) → los tres hitos anteriores.

### Esquema de copias de seguridad

- Los **tags anotados son los puntos de restauración**; no hay carpetas `backup/` ni scripts de copia en el repo.
- `origin/main` actúa como espejo remoto. Para inspeccionar un hito sin mover la rama: `git show <tag>` o `git worktree add /tmp/opencode/hammer-<tag> <tag>`.
- Si se necesita una copia física local, usar una ruta temporal aprobada, p. ej. `/tmp/opencode/hamer-sound-<tag>`.
- Los archivos eliminados en `5151964` (`app.js`, `files.zip`) solo se recuperan desde ese commit; no forman parte del estado actual.
- Regla práctica: **un hito = un commit + un tag anotado + `git push origin main --tags`**.

---

## 2. Arquitectura técnica

### 2.1 Composición

`index.html` reparte la UI en zonas (comentarios `ZONA A`…`ZONA E`): cabecera con reloj/sesión, players A/B, banco `.fx-rack`, mezclador, biblioteca y barra de estado. Además contiene tres diálogos (`#dlg-cfg`, `#dlg-info`, `#dlg-recordcase`) y el menú `#track-ctx-menu`.

`styles.css` define el tema metálico (variables `--chassis`, `--plata`, `--aluminio`, `--lcd`, LEDs) y dos media queries (`820px` y `520px`).

### 2.2 Módulos JS

Los scripts se cargan con `defer` en este orden: `seg7.js → controls.js → audio.js → deck.js → library.js → main.js`.

| Archivo | Responsabilidad | API expuesta |
|---|---|---|
| `js/seg7.js` | Render SVG de dígitos 7 segmentos | `window.renderSeg7` — **no invocado** por la UI actual |
| `js/controls.js` | Fader dibujado sobre `<input type="range">` transparente; ratón, táctil, rueda, teclado | `window.Fader` — **sin instancias** en el código actual |
| `js/audio.js` | `AudioContext`, master, crossfader cos/sen, ganancia para VU | `window.ctx`, `window.masterGain`, `window.xfade`, `window.setXf`, `window.getXfGain`, `window.setMaster`, `window.getMaster` |
| `js/deck.js` | `class Deck`: estados, grafo de audio, EQ, FX, CUE, pitch, seek, VU, LEDs | `window.Deck`, `window.EQ_PRESETS` (constante de módulo) |
| `js/library.js` | `window.Library`: archivos, recordcases, filtro, marcas, DnD, menú contextual, cola de AUTO | `window.Library` |
| `js/main.js` | Arranque, mixer, `wireFxRack`, AUTO, sesión, VU máster, botones superiores, fin de pista | `window.AutoMode`, `window.StateMachine`, `window.Session`, `window.decks`, `window.setStatus` |

`main.js` monta decks y biblioteca en `DOMContentLoaded` dentro de `safe(label, fn)`: un fallo aislado no deja la consola muerta. `audio.js` ya llamó a `initAudio()` al cargarse; el arranque lo vuelve a llamar (idempotente).

### 2.3 Grafo de audio (por deck)

```text
MediaElementSource → trimGain → eqLow(lowshelf 200 Hz) → eqHigh(highshelf 3200 Hz)
  → fxFilter(allpass | lowpass | highpass) → fxDry ──────────────→ chGain
                                           └→ fxDelay(0.28 s) ⇄ fxFeedback(≤0.45)
                                                              → fxWet ──────→ chGain
chGain → analyser → xfade[A|B].gain → master(0.8) → destination
```

`fxFilter` en `OFF` es `allpass` (transparente). `EQ_PRESETS` = `FLAT`, `BASS` (+6/−2), `TREBLE` (−2/+6), `VOCAL` (−3/+3) sobre los dos filtros *shelf*.

### 2.4 Claves de `localStorage`

| Clave | Formato exacto | Lectura / escritura |
|---|---|---|
| `hammer:master` | Número `0-1` como texto | `audio.js`: `getMaster()` / `setMaster(v, store = true)`. STANDBY llama `setMaster(0, false)` para no persistir el silencio |
| `hammer:played:v1` | `{ "<name>|<size>|<lastModified>": boolean }` | `library.js`: `_readMap()` / `_writeMap()` |
| `hammer:library:v1` | `{ folders: [{id,name}], activeFolder, tracks: [{id,key,name,title,artist,size,lastModified,version,comment,bpm,folder,played}] }` | `library.js`: `_restore()` / `_writeStore()`; `_writeMap()` también la escribe |

`track.url` y `track.missing` **jamás** se guardan. `add()` genera `URL.createObjectURL(f)`; `_restore()` devuelve `url: null, missing: true` y `render()` marca la fila con `⚠` en cursiva. `loadTo()` rechaza pistas sin `url` con el mensaje «vuelve a añadir el archivo para enlazarlo».

---

## 3. Invariantes críticos (no romper)

1. **Vúmetros**: el `analyser` de cada deck está después de `chGain` pero **antes** de `xfade[A|B].gain`. `Deck._updateVu()` multiplica el nivel por `getXfGain(this.id)`, y `drawMasterVU()` suma `A.lv + B.lv` (no `max`) y aplica `masterGain.gain.value`. Mover el analizador tras el crossfader dobla la atenuación.

2. **Crossfader de potencia constante**: `setXf(v)` usa `cos/sin` con `-1 = A`, `0 = centro`, `+1 = B`; `#cf-value` muestra `round(((v+1)/2)*100)%`. `getXfGain()` reproduce la misma curva derivando de `#crossfader` cuando no hay `AudioContext`.

3. **Cancelación de AUTO por el usuario**: el `input` de `#crossfader` llama a `setXf(cf.value, { fromSlider: true, user: true })`. `setXf()` dispara `AutoMode.cancelByUser()` → `cancelTransition()`, fija `suppressedFor` y avisa «Crossfade cancelado». No eliminar el flag `user: true`.

4. **Nunca persistir `blob:`**: `_writeStore()` solo serializa metadatos. Al re-añadir un archivo, `add()` busca por clave `name|size|lastModified`, revoca la URL anterior solo si ningún deck (`window.decks.A/B.audio.src`) la está usando, crea una nueva y pone `missing = false`.

5. **FX de plato bloqueados con AUTO**: `Session._syncFxAvailability()` deshabilita `.fx-motion button` cada 250 ms y `wireFxRack()` vuelve a comprobar `AutoMode.active` en cada clic (`guarded()`). `applyPitch()` no escribe `playbackRate` mientras `_brakeRaf` o `_startRaf` estén activos; la rampa usa `requestAnimationFrame` con mínimo `0.1`.

6. **`Reiniciar ✓` ≠ `↺ sesión`**: `Library.clearMarks()` borra `hammer:played:v1` y reescribe el store (no toca `Session`); `Session.reset()` pone `start = Date.now()` y `count = 0`, limpia `#mini-viewer` y los estilos en línea de parpadeo, sin tocar marcas ni audio.

7. **AUTO respeta la recordcase**: `_check()` y `_finishTransition()` cuentan pendientes con `library._pool()`, y `nextUnplayed()` elige dentro de ese pool. Cambiar de carpeta cambia la cola; `SHFL` elige al azar. El fin de lista llama a `_announceEnd()`, apaga AUTO y escribe `FIN DE LISTA`.

8. **Orden de arranque**: `audio.js` llama a `initAudio()` al cargarse; `deck.js` y `library.js` dependen de esos globals; `main.js` crea `decks` y llama `library.init()`. Cualquier nuevo módulo debe cargarse después de `audio.js` y antes de `main.js`, o integrarse desde `DOMContentLoaded`.

9. **STANDBY / EXIT**: `stby` silencia con `setMaster(0, false)`; `exit` sigue el orden AUTO.stop → `library.setAuto(false)` → `d.eject()` en A/B → restaurar master si había STANDBY → `setXf(0)` → limpiar `#mini-viewer`.

10. **Utilidades presentes pero sin cablear**: `img/pcdj.png`, `window.Fader` y `window.renderSeg7` existen como referencia/utilidad; no asumir que están activos en la UI. Si se usan, hay que enlazarlos explícitamente.

---

## 4. Metodología de trabajo y verificación obligatoria

Antes de dar por bueno cualquier cambio:

```bash
cd /mnt/c/Users/astur/Desktop/hamer-sound
for f in js/*.js; do node --check "$f" || exit 1; done
git diff --check
git status --short
```

En el navegador, con <http://localhost:8080> abierto:

1. Recargar con **`Ctrl + Shift + R`** y mantener **`F12`** abierto.
2. Consola: cero errores; `Application → Local Storage`: claves `hammer:*` sin cadenas `blob:`.
3. Comprobar hora del sistema, `SESIÓN`, `PINCHADOS` y el botón `↺ sesión`; verificar que `Reiniciar ✓` no reinicia el reloj.
4. Crear carpeta, mover una pista arrastrándola al chip, recargar y volver a añadir el MP3 para confirmar el re-enlace (desaparece `⚠`).
5. Filtro LP/HP y eco: el sonido y ambos vúmetros cambian; `BRAKE`/`START` funcionan fuera de AUTO.
6. Activar `AUTO`: `BRAKE`/`START` quedan deshabilitados; mover el crossfader cancela la transición; el contador sigue subiendo.

Cada hito se cierra con commit + tag anotado. Para este cambio de documentación, una vez revisado:

```bash
git add README.md HANDOFF.md
git commit -m "docs: README y HANDOFF para Silver-DjHammer"
git tag -a docs-Silver-DjHammer -m "Documentación de presentación y relevo técnico"
git push origin main --tags
```

---

## 5. Roadmap / siguientes fases

| Prioridad | Trabajo | Situación actual | Punto de partida |
|---|---|---|---|
| Alta | **EQ de 3 bandas por deck** | Solo dos filtros *shelf* y 4 presets (200 Hz / 3200 Hz) | `EQ_PRESETS` y `eqLow`/`eqHigh` en `js/deck.js`; añadir `peaking` para banda media antes de `fxFilter` |
| Alta | **Hot cues y loops** | Un único `cuePoint` por carga; sin loop | `Deck.cue()`, `_seekTo()` y `audio.loop`; plantear `loopStart`/`loopEnd` y cues por pista |
| Media | **Cálculo y match de BPM** | `bpm` es siempre `'---'`; la columna es decorativa | `Library.add()`/`_writeStore()` y `#detail-*-bpm`; analizar con `OfflineAudioContext` o metadatos y usar `pitch` para match |
| Media | **Waitlist** | No existe; `nextUnplayed()` decide directamente el siguiente tema | `Library.nextUnplayed()` y `AutoMode._check()`; añadir cola de peticiones con prioridad |
| Baja | **Limpieza de títulos** | `_cleanName()` solo quita extensión y prefijo `SpotiDown.App - `; artista/título se separan por el último `" - "` | `Library._cleanName()` y `add()`; reglas para `feat.`, `remix`, números de pista y mayúsculas |

---

## 6. Enlaces

- [Repositorio remoto](https://github.com/martillohamer/hamer-sound.git)
- [README.md — presentación y uso](README.md)
- [index.html](index.html) · [styles.css](styles.css)
- [js/audio.js](js/audio.js) · [js/deck.js](js/deck.js) · [js/library.js](js/library.js) · [js/main.js](js/main.js)
