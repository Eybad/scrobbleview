# Scrobbleview

**Tus estadísticas de Spotify, en tu dispositivo.**

Scrobbleview es una web estática que analiza tu historial extendido de Spotify y te muestra tus estadísticas de escucha: artistas, canciones, álbumes, sesiones, descubrimiento mensual, comparación anual, calendario y un "Wrapped" personal. Todo el procesamiento ocurre en tu navegador: **tus datos nunca salen de tu dispositivo**.

## Características

- **100 % local**: arrastrás tus archivos JSON y el navegador los procesa. Cero servidores, cero telemetría, cero CDN. Funciona incluso sin conexión a internet.
- **Sin build, sin dependencias**: JavaScript vanilla + SVG, ES modules. Un repo estático que se sirve tal cual.
- **7 vistas**: dashboard con KPIs y heatmap día×hora, fichas de artista/canción/álbum, sesiones, descubrimiento mensual, comparación anual, calendario con días de inactividad y un "Wrapped" personal.
- **Filtros cruzados** (rango, año, mes, franja horaria, día, skip/shuffle/offline) que re-agregan las estadísticas sin re-parsear los archivos. El filtrado por artista/canción/álbum existe en la lógica (`src/filters.js`); su UI está en camino.
- **Accesible**: gráficos SVG con `aria-label`, tooltips no dependientes del hover, tablas de respaldo navegables por teclado y soporte de `prefers-reduced-motion`.
- **Caché opcional** en IndexedDB con consentimiento explícito y botón para borrar.

> [!NOTE]
> **Privacidad como feature central.** Los archivos se procesan íntegramente en el dispositivo. La política de seguridad del contenido (`connect-src 'none'`) impide cualquier conexión de red desde la aplicación. Podés desconectarte de internet y todo sigue funcionando.

## Requisitos

- Un navegador moderno con ES modules e `Intl` (las zonas horarias vienen de serie; no hay que instalar nada).
- Sin cuentas, sin red y sin `.env`: no hay nada que configurar fuera de la propia aplicación.
- Solo para desarrollo y tests: Node.js ≥ 18.13 con ICU completa. En Termux: `pkg install nodejs`.

## Empezar

1. Abrí la aplicación publicada en GitHub Pages, o serví el repo en local con `python3 -m http.server 8000` y abrí `http://localhost:8000` (`file://` no funciona: el navegador bloquea los ES modules locales).
2. Arrastrá tus archivos `Streaming_History_Audio_*.json` (podés seleccionar varios).
3. Listo: explorá tus estadísticas. Todo queda en tu dispositivo.

Sin archivos a mano, el botón **"Probar con datos de ejemplo"** genera un historial sintético determinista.

## Uso

- Acepta uno o varios archivos de historial extendido; las fuentes se concatenan y los identificadores quedan consistentes entre archivos.
- Los episodios de podcast se detectan y se excluyen de las estadísticas de música (quedan registrados como avisos).
- Los filtros re-agregan sobre un subconjunto con el mismo código que la vista global: cada vista filtrada es tan completa como la global.
- Tras un análisis exitoso podés guardar el dataset en IndexedDB (solo con tu confirmación) y borrarlo cuando quieras desde el banner o la pantalla de inicio.

### Datos de entrada

Scrobbleview consume el **historial extendido de Spotify** (los JSON que descargás desde tu cuenta de Spotify → *Privacy settings* → *Download your data*). Los archivos relevantes son `Streaming_History_Audio_*.json`.

## Configuración

No hay archivo de configuración. Las constantes del análisis viven en un solo lugar, `src/defaults.js`:

- `minMs = 30000`: duración mínima para contar como reproducción significativa.
- `skipThresholdMs = 10000`: por debajo de esto, una reproducción corta cuenta como salto.
- `SESSION_GAP_MINUTES = 30`: silencio mayor a esto abre una sesión nueva.
- La zona horaria es siempre la del navegador (construida en `app/main.js` sobre el rango del dataset).

## Tests

```sh
node --test        # 77 tests: parse, aggregate, analyze, filtros, zonas horarias, escaping
```

- Sin dependencias: `package.json` solo define `type: module` y el script de tests.
- Las zonas horarias se resuelven con `Intl` construyendo una tabla de transiciones (muestreo + refinamiento al segundo exacto); cada lookup posterior es una búsqueda binaria.

## Estructura del proyecto

```
src/parse      scanner JSON incremental → Dataset columnar (23 B/evento)
src/aggregate  Dataset → StatsModel (pura, determinista)
src/filters    lógica pura de filtros + re-agregado (testeable, sin DOM)
src/charts     8 componentes SVG puros (string → HTML, sin DOM)
app/           composition root, vistas, filtros UI, storage IndexedDB, demo
test/          parse, aggregate, analyze, filters, tz, xss, views-xss
```

El pipeline es un seam único: `analyze(files)` → `StatsModel`:

```
tus JSON de Spotify
        │
        ▼
   parse ──► Dataset columnar (23 B/evento)
        │
        ▼
 aggregate ──► StatsModel (totales, rankings, temporal, sesiones, transiciones…)
        │
        ▼
  filtros ──► re-agregado sobre el subconjunto (sin re-parsear)
        │
        ▼
   vistas SVG (7) + tablas de respaldo
```

## Tecnología

Vanilla JavaScript (ES modules) · SVG · IndexedDB · `Intl` (zonas horarias) · Node.js solo para tests.
