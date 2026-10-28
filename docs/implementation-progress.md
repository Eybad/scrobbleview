# Seguimiento de Implementación — Scrobbleview

## 1. Identificación y Estado Base

- **Fecha de inicio**: 28 de octubre de 2026.
- **Entorno**: Termux en Android (aarch64, bionic, Node v26.12.1).
- **Repositorio**: `/data/data/com.termux/files/home/proyectos/scrobbleview`
- **Rama de trabajo**: `feat/deepening-plan` (bifurcada desde `main`).
- **HEAD inicial**: `4aa7023c14ded79bd6564529457aec55ef67e1ab` ("ignore local data and tighten JSON exceptions").
- **Estado del árbol de trabajo**: Limpio, sin modificaciones previas sin registrar.

## Correcciones iniciadas el 28 de octubre de 2026

- Base revisada: `55f9d9289f09b07808147de0b03e0b413b5e0852`, rama `feat/deepening-plan`, árbol limpio antes de las correcciones.
- C01: la vista de comparación informa que el período B no está calculado; la comparación real queda pendiente en R7. `node --test`: 309 pruebas aprobadas, 0 fallidas. No se verificó en navegador.
- C18: se actualizó el selector de Sesiones y la expectativa de cancelación de filtro del harness. `node --check browser-tests/navigation.js` aprobó; la ejecución en navegador, la cancelación de importación y la de exportación siguen pendientes.
- C02 y C03, avance: regresos y retención recorren el orden UTC; los regresos se seleccionan por evento y el extremo histórico usa el máximo UTC. La cohorte contiene primeras apariciones históricas seleccionadas; el seguimiento posterior usa todo el historial. Pruebas de `analyze` y del motor cubren inversión de eventos, igualdad temporal y filtros no temporales. `node --test test/acceptance-etapa7.test.js`: 8 pruebas aprobadas.
- C07, avance: Explorar y las opciones de exportación usan `totals.records` para cuotas por reproducciones. `node --test test/explore-view.test.js test/acceptance-etapa8.test.js`: 10 pruebas aprobadas; falta reconciliar la exportación real y su elegibilidad con la pantalla.
- C06, avance: las transiciones y rachas usan pertenencia definitiva de sesiones originales, incluso si un intervalo posterior une sesiones o si el filtro oculta ese intervalo. El motor conserva el índice por dataset. `node --test`: 316 pruebas aprobadas; la prueba enfocada posterior aprobó 5. Falta detalle paginado de miembros en R3.
- C04, avance: el motor expone consultas paginadas de día y sesión con miembros exactos de la selección y resumen acotado. Las fichas consumen esas respuestas y el inspector enlaza el día; una prueba cruza Worker, cliente, controlador y render de strings. `node --test test/worker.test.js test/analysis-detail.test.js test/analysis-state.test.js test/acceptance-etapa4.test.js`: 16 pruebas aprobadas. Falta verificar DOM, foco y navegación en navegador, y completar recuperación y enlaces contextuales.
- C05, avance: la ficha de canción consulta atribuciones paginadas y primera aparición histórica al Worker. `node --test test/analysis-detail.test.js test/analysis-state.test.js test/worker.test.js test/acceptance-etapa6.test.js`: 19 pruebas aprobadas. El origen verificable de álbum y su reconciliación con CSV siguen pendientes.
- C09, avance: la codificación de segmentos admite sustitutos Unicode aislados sin colisionar con texto literal. `node --test test/routes.test.js`: 5 pruebas aprobadas; la migración completa de enlaces y recuperación de rutas numéricas siguen pendientes.
- Medición aislada posterior al cambio, Termux/Node v26.12.1: `node --expose-gc bench/aggregate.js 100000 --compact`, agregado 2000 ms, filtrado 1479 ms, conteo 6 ms, RSS pico 261 MiB. Es una muestra Node, no una medición de navegador ni una comparación repetida.
- Siguiente tarea: completar R0 (harness), cerrar R1 y continuar R2–R3 con detalle de sesiones. Los demás fallos del plan siguen pendientes de corrección y verificación integrada.
- Las secciones históricas siguientes registran lo que se afirmó en cada etapa; no acreditan aceptación actual. La revisión posterior detectó integraciones incompletas y resultados incorrectos.

## 2. Verificación de Partida y Progreso

### Suite de pruebas unitarias y de integración (`node --test`)
- **Baseline inicial**: 235 pruebas (13,29 s).
- **Estado actual tras Etapa 5**: 296 pruebas aprobadas, 0 fallidas (10,73 s).

### Benchmark base (100.000 eventos compactos)
- Comando: `node --expose-gc bench/aggregate.js 100000 --compact`
- Eventos: 100.000 (10.000 tracks, 50.000 records).
- Agregación: 1771 ms.
- Filtrado: 974 ms.
- Conteo: 19 ms.
- Pico RSS: 264 MiB.

### Estado de la regresión de navegador (`browser-tests/navigation.js`)
- **Aserción obsoleta corregida**: Línea 89 actualizada para comprobar `100%` y `▲` en concordancia con `deltaSub()`, conservando la verificación numérica estricta.

## 3. Inventario de Conservación del Sistema Existente

Ninguno de los siguientes componentes, métricas o capacidades puede ser removido o deshabilitado durante las etapas de desarrollo:

### 3.1. Vistas y Secciones (8 principales + 3 fichas de detalle)
1. **Resumen (`dashboard`)**:
   - KPIs agrupados en Actividad, Continuidad y Comportamiento dentro de un único grid accesible.
   - Panel de calidad y cobertura de datos (fuentes, rango observado, zona horaria, desconocidos, umbrales y advertencias).
   - Gráficos: Actividad día × hora (heatmap + tabla accesible), Evolución mensual (lineChart), Distribución de duración (hbarChart).
   - Componentes: Récords (recordsGridHTML), Rankings con tabs accesibles APG (Artistas, Canciones, Álbumes), Tablas con límite (Obsesión, Rachas, Mayor tasa de salto artistas/canciones, Menor tasa de salto artistas/canciones, Primera/Última canción del día) con indicación de bases conocidas y estados vacíos descriptivos.
2. **Horarios (`hours`)**:
   - Nota explícita de atribución de actividad al timestamp de finalización de evento.
   - KPIs de picos: Hora pico, Hora valle, Día pico, Bloque pico, Fin de semana vs. Días de semana.
   - Gráficos: 24 horas (barChart), Días de la semana (hbarChart), Bloques horarios (stackedBar), Reloj de escucha 24h.
   - Tabla detallada de 24 horas agrupada por bloques.
3. **Hábitos (`habits`)**:
   - Tabla de concentración: Artistas, Canciones, Álbumes con entidades conocidas/desconocidas, número efectivo, HHI, Gini y Entropía.
   - Curva de Pareto: Top 1, Top 5, Top 10, Top 50 por artista, canción y álbum.
   - Evolución mensual de saltos y aleatorio (líneas temporales).
   - Tablas: Transiciones entre artistas (con indicación de repeat vs. cambio), Pares de motivos de inicio/fin, Curiosidades de catálogo (One-hit wonders, Artistas de catálogo profundo, Olvidados).
4. **Sesiones (`sessions`)**:
   - KPIs: Conteo de sesiones, Duración promedio, Tiempo total, Pausa promedio, Sesión más larga.
   - Gráficos: Distribución por bloques, Hora de inicio, Meses, Días de la semana.
   - Tablas: Sesiones más largas por duración y por reproducciones con códigos de motivo descriptivos y no fusionados (`trackdone`, `endplay`, `logout`).
5. **Descubrimiento (`discovery`)**:
   - KPIs: Primeras apariciones, Escuchas de catálogo, Promedio por mes activo, Artistas únicos.
   - Gráfico: Canciones nuevas por mes.
   - Tablas: Meses con más descubrimientos, Meses con mayor proporción de nuevas, Constancia (con continuidad en etapa activa y cobertura del período observado, denominadores explícitos y mínimo de 6 meses), Longevidad de artistas.
6. **Años (`yearly`)**:
   - Tabla anual con enlaces al calendario, tiempo, reproducciones, artistas identificados (coincidentes con Resumen) y desconocidos separados, canciones, álbumes, descubrimientos, top artista, top canción, saltadas y rachas.
   - Gráfico apilado por bloques horarios por año.
7. **Calendario (`calendar` / `calendar/:year`)**:
   - Índice general de años y vista de año individual.
   - Vista anual panorámica con escala de intensidad accesible y selector interactivo de días para filtrado.
8. **Resumen del período (`wrapped`)**:
   - Hero card con arquetipo de oyente como patrón heurístico descriptivo, reglas consultables y mención de desconocidos.
   - Hitos y primeras veces del período.
   - Resumen en formato recibo con botón de copia al portapapeles.
9. **Fichas de entidad**:
   - **Artista (`artist`)**: Totales, primera escucha, meses activos, reloj de distribución horaria, evolución mensual, Top canciones, Top álbumes.
   - **Canción (`track`)**: Totales, primera escucha, artista asociado, álbum (o atribución múltiple), distribución de duración, meses activos, evolución.
   - **Álbum (`album`)**: Totales, primera escucha, artista asociado, tabla de canciones del álbum con estadísticas propias.

### 3.2. Filtros y Estado Analítico
- Intervalo temporal por fechas exactas (inputs date) y accesos rápidos (4 semanas, 6 meses, 1 año, Todo).
- Días de la semana conmutables (Lunes a Domingo).
- Franjas horarias conmutables (Madrugada, Mañana, Tarde, Noche).
- Modos de reproducción: Shuffle, Offline, Skips con soporte de estado desconocido.
- Umbrales configurables: reproducción significativa (`minMs`) y reproducción corta (`skipThresholdMs`).

### 3.3. Exportación y Almacenamiento
- Exportación JSON completa (`modelToJSON`).
- Exportación ZIP con 7 tablas CSV (`totals`, `artists`, `tracks`, `albums`, `album_tracks`, `sessions`, `monthly`) con escape y neutralización de fórmulas CSV.
- Formato recibo de texto plano para portapapeles.
- Caché IndexedDB opcional con consentimiento explícito y versión de esquema 2.

## 4. Matriz de Etapas del Plan

| Etapa | Descripción | Estado |
|---|---|---|
| **0** | Reconocimiento, base y seguimiento | **Completada** |
| **1** | Correcciones de lectura y definiciones | **Completada** |
| **2** | Contexto, rutas, espera y cancelación | **Completada** |
| **3** | Catálogo completo y tablas reutilizables | **Completada** |
| **4** | Gráficos y calendario accesibles | **Completada** |
| **5** | Comparación A/B y evolución | **Completada** |
| **6** | Día, sesiones y secuencias explicables | **Completada** |
| **7** | Descubrimiento, regresos y hábitos longitudinales | **Completada** |
| **8** | Exportación, personalización y cierre de calidad | **Completada** |

## 5. Detalle de Cambios — Etapa 1

1. **Cascada móvil**: En `css/style.css`, se trasladaron los overrides `@media (max-width: 640px)` de `.kpis`, `.records-grid` y `.filter-presets` para que sucedan a sus declaraciones base, garantizando estilos calculados consistentes y dos columnas operativas en móviles (320–640 px).
2. **Agrupación de KPIs**: Se organizaron los KPIs en *Actividad*, *Continuidad* y *Comportamiento* dentro de una cuadrícula uniforme (`.kpi-group-heading`) que preserva la estructura accesible de lista de definiciones.
3. **Redondeo y formato de duración**: En `src/charts.js`, se normalizó `fmtMs` para redondear unidades antes de descomponerlas, impidiendo `60s` o `60 min` (e.g. `59999 ms → 1 min 0 s`, `119999 ms → 2 min 0 s`, `3599999 ms → 1 h 0 min`), aplicando coma decimal local (`12,5 s`).
4. **Intervalos no ambiguos**: En `src/aggregate/impl/totals.js`, se adoptó la notación matemática de intervalos semiabiertos: `<10 s`, `10–<30 s`, `30–<60 s`, `1–<3 min`, `3–<5 min`, `≥5 min`.
5. **Separación de artista desconocido anual**: En `src/aggregate/impl/temporal.js`, los eventos sin artista (`ev.ar === 0`) se contabilizan por separado en `unknownArtistPlays`/`unknownArtistMs` sin contaminar `y.artistsC`, reconciliando el conteo de artistas identificados entre la tabla de Años y Resumen.
6. **Métricas de constancia**: En `src/aggregate/aggregate.js`, se incorporó `periodCoverage` y `observedMonths` junto con la continuidad activa (`coverage`, `activeMonthsSpan`), exhibiendo ambos denominadores en `app/views.js` con explicación del umbral de 6 meses.
7. **Códigos de motivo descriptivos**: En `app/views.js`, `REASON_LABELS` ahora presenta descripciones verificables sin afirmar reproducción completa (`Fin de pista (trackdone)`) y separa explícitamente `Fin de reproducción (endplay)` de `Cierre de sesión (logout)`.
8. **Denominadores de tasas y elegibilidad**: Se informan bases conocidas y desconocidas en las tasas del Resumen y rankings de saltos; las tablas vacías distinguen la falta de muestra mínima (20 banderas conocidas) de la ausencia de datos.
9. **Atribución de actividad temporal**: Se documentó que la agregación horaria y diaria se imputa al final de cada evento y no a una distribución estimada minuto a minuto.
10. **Panel de calidad**: Se añadió en `dashboard` un panel colapsable que centraliza metadatos de fuentes, rango observado, zona horaria, registros con datos desconocidos, exclusiones y advertencias.
11. **Arquetipo como patrón heurístico**: En `wrappedView`, se incorporó el detalle consultable de reglas estadísticas locales y aviso de banderas desconocidas, descartando inferencias psicológicas.
12. **Aserción de regresión**: Actualizada `browser-tests/navigation.js` para aceptar el formato con glifo `▲ 100%`.

## 6. Detalle de Cambios — Etapa 2

1. **Unificación de métrica analítica**: En `app/state-metric.js`, se fijó `ms` (*Tiempo escuchado*) como métrica analítica inicial por defecto, estableciendo jerarquía de prevalencia: URL query param (`?m=ms` / `?m=plays`) > preferencia almacenada (`localStorage`) > default. Se propagó el contexto unificado `{ metric }` a todas las vistas, tablas y gráficos.
2. **Coalescencia de solicitudes analíticas**: En `app/analysis-client.js`, se implementó una cola en el cliente que mantiene a lo sumo una solicitud de filtro activa en el Worker y a lo sumo una pendiente reemplazable con el último estado. Se expuso `dispatchedFilterCount` para verificar que ráfagas de 5 filtros generen como máximo 2 envíos efectivos (criterio A13).
3. **Cancelación lógica sin descarga**: Se incorporaron `cancelUpdate()` y `cancelExport()` en `analysis-client.js` y `analysis-state.js` para descartar resultados obsoletos o cancelados sin terminar el Worker ni perder el dataset en memoria (criterio A14). Solo la cancelación de importación reinicia el worker.
4. **Preservación del modelo confirmado y feedback no bloqueante**: En `app/main.js`, se eliminó `root.hidden = true` durante el refresco analítico; el modelo confirmado se conserva visible con `aria-busy="true"` y clase `.app--updating` (opacidad 0.65 y `pointer-events: none` en CSS). Los errores de filtro conservan el dataset e invitan a reintentar o ajustar filtros sin exigir volver a cargar archivos.
5. **Rutas semánticas versionadas (v1)**: En `app/routes.js`, se implementaron rutas semánticas estables (`#/v1/artist/<nombre>`, `#/v1/track/<artista>/<titulo>`, `#/v1/album/<artista>/<titulo>`) con codificación URL segura, resolución a IDs internos del dataset actual independiente del orden de carga de archivos (criterio A12) y fallback de búsqueda/recuperación para entidades inexistentes y enlaces numéricos legados.
6. **Transporte de contexto en enlaces y nueva pestaña**: Enlaces internos y navegación de retorno incorporan parámetros analíticos (`?m=...&range=...`) directamente en el atributo `href` del DOM, permitiendo abrir en nueva pestaña o copiar enlaces sin depender de reescrituras en el click (criterio A11).
7. **Captura y restauración de historial**: En `app/history-state.js`, se implementó la captura de `scrollY`, `scrollX`, selector del elemento con foco y scroll de tablas/gráficos en `history.state` (`returnState`). Al pulsar Atrás (`popstate`), se restauran exactamente fila, scroll y foco con `preventScroll: true` (criterio A10).
8. **Franja contextual compacta**: En `app/context-bar.js` y `css/style.css`, se implementó una franja contextual (`.context-bar`) de ≤ 2 filas que resume el período activo, chips de filtros aplicados y switch de métrica unificado respetando safe-areas móviles.

## 7. Detalle de Cambios — Etapa 3

1. **Motor de consulta puro (`src/query.js`)**: Extracción de funciones puras de normalización de texto sin diacríticos (`normalizeSearchText`), búsqueda sin fusionar identidades (`matchesQuery`), asignación de ordinal métrico determinista y cálculo de cuota analítica global (`rankEntities`), y consulta paginada con desempates estables (`queryCatalog`). Cero dependencias de DOM o Worker.
2. **Componente de tabla reutilizable y paginación accesible (`app/catalog-table.js`)**: Renderizado semántico con `aria-sort`, paginación accesible con selector de tamaño (25/50/100 filas), selector de densidad (cómoda/compacta), selector de columnas secundarias (`columnsPickerHTML`), estado vacío explicativo con botón para limpiar búsqueda, y desambiguación obligatoria de canciones homónimas por artista.
3. **Identidad fija y expansión de nombres**: Encabezados y celdas sticky para retener identidad en scroll horizontal; botón de expansión de nombres completos (`.btn-name-expand`) para visualización íntegra en pantallas táctiles y teclado sin navegar.
4. **Vista de catálogo completo (`Explorar`)**: Incorporación de sección `Explorar` (`#/v1/explore`) en navegación principal (`app/main.js`, `app/views.js`), tabs para Artistas, Canciones y Álbumes con todas las columnas analíticas (tiempo, reproducciones, cuota del subconjunto, días, meses, fechas extremas, intensidad, tasa de salto con denominador conocido y sparklines mensuales de la página activa).
5. **Enlaces contextuales desde tarjetas auxiliares**: Acceso directo desde las tarjetas de Obsesión, Saltos (artistas y canciones), Fidelidad, Constancia y Longevidad hacia `Explorar` transportando filtros analíticos, ordenamiento y umbrales configurables con validación de rango.
6. **Consultas locales sin re-agregación**: Las operaciones de tabla (búsqueda con preservación de caret, paginación, ordenamiento y filtros de umbral) operan sobre el modelo confirmado en memoria sin disparar tareas al Worker ni re-agregar el dataset.

## 8. Criterios de Aceptación Verificados (Etapas 1, 2, 3, 4 y 5)

- **A01 / A02**: Cascada móvil y KPIs responsivos probados y colocados tras las definiciones base.
- **A03**: Redondeo consistente en `fmtMs` sin unidades `60s`.
- **A04**: Tasas de salto con base conocida y desconocidos separados.
- **A05**: Coincidencia de artistas identificados entre Resumen y Años.
- **A06**: Constancia separa continuidad activa de cobertura del período observado.
- **A07**: Recorrido completo con paginación sobre >150 entidades y >100 coincidencias (`test/acceptance-etapa3.test.js`).
- **A08**: Orden global estable previo a la paginación y cuota analítica invariante frente a página o búsqueda.
- **A09**: Canciones homónimas de artistas distintos con identidad visible y enlaces semánticos diferenciados.
- **A10**: Ida y vuelta desde fila de tabla restaura scroll de página, tabla y foco exacto.
- **A11**: Navegación entre entidades y apertura en nueva pestaña transporta contexto analítico en `href`.
- **A12**: Inversión de orden de archivos en la carga resuelve idénticamente las rutas semánticas.
- **A13**: Ráfaga de 5 filtros con Worker ocupado produce ≤ 2 solicitudes efectivas y modelo final correcto.
- **A14**: Cancelación lógica de filtro y exportación no termina el Worker ni borra el dataset.
- **A15**: 24 posiciones horarias completas para Hora de inicio en sesionesstats y vistas; gráfico y tabla exacta coinciden preservando ceros.
- **A16**: Inspector de día persistente en calendario con acciones explícitas (`Filtrar día`, `Fijar inicio`, `Fijar fin`, `Aplicar rango`) sin depender de Shift, y vista mensual interactiva con botones táctiles ≥40px.
- **A17**: Escala compartida entre años por defecto en el índice de calendarios y modo explícito de normalización anual identificada.
- **A18**: Comparación A/B con base cero sin `Infinity` ni `NaN` (`nuevo`/`0,0%`), fechas y bases explícitas, y aviso visible ante ventanas que exceden el intervalo registrado.
- **A19**: Reconciliación exacta de series diaria, semanal y mensual sin duplicación ni pérdida de eventos en transiciones DST, con banderas de períodos parciales identificadas.
- **A20**: Canción compartida por álbumes distingue totales globales agrupados de atribución por álbum específico (`trackView` con selector de alcance y tabla de álbumes asociados).
- **A21**: Adyacencia en selección, consecutivas en historial original y dentro de sesiones originales diferenciadas en transiciones y rachas (`maxRun`), con probabilidades condicionadas en transiciones.
- **A22**: Sesiones fusionadas por intervalos largos preservan membresía exacta, totales coherentes y vista individual `sessionView` con inicio/fin estimados, pausas y advertencia descriptiva.
- **A23**: Primeras apariciones y regresos calculados sobre la cronología histórica completa para no crear pausas artificiales ni reiniciar descubrimiento al filtrar.
- **A24**: Retorno acumulado en 30/90 días con detección estricta de seguimiento insuficiente cuando el dataset termina antes de la ventana, excluyéndolo del denominador sin división por cero.

## 9. Detalle de Cambios — Etapa 4

1. **Contrato común de gráficos (`src/chart-contract.js`)**: Definición del contrato estructurado (`createChartContract`) con metadatos (título, unidad, base, rango, total, max, min), generación de tabla exacta de datos (`chartDataTableHTML`) con soporte para ceros, fechas y cuotas, y contenedor con inspector y controles de navegación por pasos (`renderChartWithContract`).
2. **Completitud de 24 horas en sesiones (`src/aggregate/impl/sessions.js`, `app/views.js`)**: `startHour` se inicializa con las 24 horas (0–23) en 0 para no comprimir el eje temporal ni omitir horas sin sesiones (criterio A15).
3. **Inspector y selector de rango de calendario (`app/calendar-ui.js`, `app/main.js`)**: Incorporación de panel accesible (`calendarInspectorHTML`) que permite consultar fechas e imputar rangos mediante inputs fecha y botones explícitos sin requerir Shift ni precisión táctil microscópica (criterio A16).
4. **Vista mensual interactiva (`app/calendar-ui.js`, `app/views.js`)**: Incorporación de vista mensual navegable (`calendarMonthViewHTML`) con celdas táctiles de cómodo acceso (≥40px), tabla fallback de lista diaria y roving focus.
5. **Escala compartida y normalización anual (`app/calendar-ui.js`, `app/views.js`)**: En `calendarIndexView`, la intensidad de color es compartida por defecto entre todos los años observados (`makeScale(sharedMax)`). Se incluye control de escala (`calendarScaleToggleHTML`) con explicación visible para conmutar a normalización individual por año (criterio A17).

## 10. Detalle de Cambios — Etapa 5

1. **Motor de comparación analítica puro (`src/compare.js`)**: Cálculo puro de rangos temporales A/B (`calculateCompareRange`) con presets (`equal_previous`, `same_period_last_year`, `manual`), detección de ventanas fuera de rango, deltas seguros sin divisiones por cero (`computeMetricDelta`), y agrupación de series diaria, semanal y mensual (`buildCompareSeries`).
2. **Promedios con denominadores explícitos**: Exposición clara de promedio por día del rango y promedio por día activo con indicación exacta de los días que componen cada denominador (`compareAverages`).
3. **Ranking comparativo de entidades y transiciones**: Cálculo de variaciones ordinales, permanencias, entradas (`Entrada`), salidas (`Salida`) y diferencias de cuota analítica expresadas en puntos porcentuales (`pp`).
4. **Vista `Comparar` (`app/compare-view.js`, `app/main.js`, `app/views.js`)**: Incorporación de sección `Comparar` (`#/v1/compare`), navegación dedicada en `navHTML`, selector de presets, resumen de rangos, grid de KPIs comparados y tabla de transiciones con tabla fallback accesible.

## 11. Detalle de Cambios — Etapa 6

1. **Tres modalidades para rachas y transiciones (`src/aggregate/impl/derive.js`, `src/aggregate/impl/transitions.js`, `src/aggregate/impl/behavior.js`, `src/aggregate/aggregate.js`)**:
   - `utcPositions` derivado para trazar la posición cronológica original exacta de cada evento.
   - Seguimiento paralelo en tres modalidades: `selection` (adyacencia en subconjunto filtrado), `originalConsecutive` (adyacencia estricta en el historial original donde ambos cumplen el filtro) y `originalSession` (adyacencia original perteneciente a la misma sesión calculada antes de filtrar).
   - Cálculo de probabilidad observada por artista de origen (`baseCounts`, `prob`) en transiciones (criterio A21).
2. **Atribución de álbum vs. canción agrupada (`app/views.js`)**:
   - En `trackView`: si se accede desde un álbum (`ctx.albumOrigin` o parámetro `?album=<ak>`), se presenta aviso de alcance con cifras específicas en ese álbum y enlace a los totales de la canción agrupada.
   - Tabla de atribución por álbum mostrando todas las apariciones asociadas con sus reproducciones, tiempo y cuota (criterio A20).
3. **Ficha de sesión individual (`sessionView` en `app/views.js`, `app/routes.js`)**:
   - Detalle accesible para `#/v1/session/:id` (y enlace desde rankings de sesiones más largas y con más reproducciones).
   - Exhibición de inicio y fin estimados, duración estimada transcurrida, tiempo sumado, estimación de pausas, canciones y artistas más reproducidos, y advertencia metodológica explícita sobre estimación de tiempos y solapamientos (criterio A22).
4. **Detalle de día (`dayView` en `app/views.js`, `app/routes.js`)**:
   - Detalle para `#/v1/day/:date` con totales de reproducciones, tiempo, canciones y artistas del día, sesiones ocurridas y botón de acción para filtrar por el día.

## 12. Detalle de Cambios — Etapa 7

1. **Módulo analítico longitudinal puro (`src/longitudinal.js`)**:
   - `computeComebacks(ds, opts)`: Detección cronológica de regresos tras pausas prolongadas (30/90/180 días) calculada sobre la secuencia global original de eventos, proyectando al período de visualización sin inventar pausas artificiales (criterio A23).
   - `computeRetention(ds, opts)`: Medición de retorno acumulado a 30 y 90 días desde la primera aparición, con exclusión matemática rigurosa de entidades con seguimiento insuficiente cuando el dataset cargado termina antes de cumplirse la ventana temporal, impidiendo divisiones por cero o tasas engañosas (criterio A24).
   - `computeMonthlyLongitudinal(ds, tz)`: Evolución mensual de concentración (HHI, número efectivo de artistas, cuotas Top 1/5/10) y tasas de salto, aleatorio y modo sin conexión con sus respectivos denominadores conocidos y desconocidos.
2. **Integración con agregación (`src/aggregate/aggregate.js`)**:
   - Incorporación de `retention` (r30 y r90) y `comebacks` en `StatsModel`.
   - Inclusión en `tables` de `firstAppearances` (listas de canciones y artistas descubiertos en el período con fecha, escuchas posteriores, tiempo y días activos), `comebacks` y distancias temporales dobles en `forgotten` (`daysSinceEnd` del dataset vs. `daysSinceNow` de hoy).
3. **Sección de Descubrimiento y Hábitos en UI (`app/views.js`)**:
   - En `discoveryView`: KPIs de retorno acumulado en 30 y 90 días con indicación de casos con seguimiento insuficiente, tarjeta con tabla de regresos tras pausas ≥30 días, y tabla de primeras apariciones en el período.
   - En `habitsView`: Visualización dual de tiempo transcurrido para entidades olvidadas (respecto al final del archivo cargado y respecto a la fecha actual).

## 13. Detalle de Cambios — Etapa 8

1. **Exportación con alcances visibles y diálogo accesible (`dialog#dialog-export` en `index.html`, `app/main.js`)**:
   - Diálogo nativo accesible con opciones explícitas: `Todo el historial`, `Selección analítica actual` y `Tabla actual del catálogo`.
   - Conteo previo de eventos y advertencia metodológica transparente: archivos ZIP contienen tablas tabulares agregadas en CSV para hojas de cálculo y no constituyen respaldo para reimportar en la aplicación.
2. **Metadata en exportación ZIP (`app/analysis-engine.js`)**:
   - Inclusión automática de tabla `metadata.csv` con esquema, versión (`EXPORT_VERSION = 1`), zona horaria, alcance, totales, marcas de tiempo y detalle de filtros activos (rango, años, días de la semana y horas).
3. **Exportación de tabla de catálogo completa (`src/export.js`, `app/views.js`, `app/main.js`)**:
   - Función pura `exportExploreTableCSV`: exporta la totalidad de coincidencias de la consulta analítica sin limitarse a la página visible (criterio A25).
   - Botón directo en la barra de herramientas del catálogo mostrando el total de filas coincidentes.
   - Neutralización estricta de prefijos de fórmulas en CSV (`=`, `+`, `-`, `@`, `\t`, `\r`) ante exportaciones (criterio A26).
4. **Copia de resumen contextualizado (`receiptText` en `app/views.js`, `app/main.js`)**:
   - Generación de resumen para portapapeles incorporando el período efectivo, zona horaria observada, criterio de ordenamiento activo (tiempo vs. reproducciones) y lenguaje diferenciado (`del año` para años completos vs. `del período` para rangos parciales o filtrados).
5. **Personalización y accesos rápidos desacoplados de IndexedDB (`app/main.js`, `css/style.css`)**:
   - Paneles favoritos (`scrobbleview:favorites`) administrables con botón estrella en cabecera de vistas y renderizados como chips de acceso rápido sobre la barra de navegación sin sustituir el índice de secciones.
   - Botón de restablecimiento de preferencias (`data-action="reset-preferences"`) que limpia configuraciones de interfaz (métricas, límites de tabla, densidad, columnas y favoritos) preservando íntegramente el historial en memoria y la caché IndexedDB.
6. **Diferimiento de calendarios anuales previos (`calendarIndexView` en `app/views.js`, `app/main.js`)**:
   - Reducción del costo de renderizado inicial dejando los años previos plegados con atributo `data-deferred-year` y materialización bajo demanda al desplegar el elemento `<details>`.
7. **Cierre de Matriz de Aceptación y Rendimiento (`test/acceptance-etapa8.test.js`)**:
   - Verificados los criterios A25, A26, A27 y A28 (20 ciclos sin fugas ni crecimiento sostenido de memoria retenida).
   - Suite total aprobada al 100% (309 tests pasando, 0 fallos).

## 14. Matriz de Aceptación — Evidencia histórica (A01 a A28)

Las referencias a Node indican pruebas de funciones, markup o mocks, no validación de DOM, accesibilidad ni navegador. Los criterios de integración y manuales siguen pendientes; C01–C18 identifican fallos o faltantes. Estados posibles: implementado, verificado en Node, verificado en navegador, manual pendiente, fallido y no implementado. La matriz no acredita aceptación completa.

| ID | Caso | Resultado | Estado |
|---|---|---|---|
| A01 | 320/360/393/412/640 px, texto ampliado | Cifras y controles legibles; sin scroll horizontal; layout responsive | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa1.test.js`) |
| A02 | KPIs móviles | Estilos en 2 columnas útiles, sin desbordes ni texto cortado | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa1.test.js`) |
| A03 | 59.999, 119.999 y 3.599.999 ms | Redondeo coherente; nunca `60s` en unidad inferior | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa1.test.js`) |
| A04 | 100 eventos, 20 flags conocidos, 10 saltos | 50 %, base 20, desconocidos 80; ninguna interpretación 10/100 | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa1.test.js`) |
| A05 | Una reproducción sin artista | Mismo conteo de artistas identificados en Resumen y Años | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa1.test.js`) |
| A06 | Artista activo ene-jun, período observado ene-dic | Continuidad activa 100 %; cobertura 50 %; denominadores visibles | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa1.test.js`) |
| A07 | >150 entidades y >100 coincidencias | Acceso a todas las filas con paginación y total correcto | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa3.test.js`) |
| A08 | Ordenar después de buscar y cambiar de página | Orden global estable; cuota independiente de página | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa3.test.js`) |
| A09 | Canciones homónimas de artistas distintos | Identidad visible y enlaces correctos por clave compuesta | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa3.test.js`) |
| A10 | Abrir entidad desde una fila y volver | Misma fila, scroll de página/tabla, consulta y foco conservados | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa2.test.js`) |
| A11 | Artista A → artista B y nueva pestaña | Encabezado/foco correctos; contexto transportado en href | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa2.test.js`) |
| A12 | Misma importación con archivos en distinto orden | Rutas semánticas resuelven la misma entidad deterministamente | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa2.test.js`) |
| A13 | Ráfaga de cinco filtros con Worker ocupado | Máximo 1 en ejecución y 1 pendiente; estado final consistente | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa2.test.js`) |
| A14 | Error/cancelación de filtro o exportación | Modelo y dataset utilizables; no se descargan resultados truncos | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa2.test.js`) |
| A15 | Serie larga, horas ausentes, todo cero | 24 posiciones horarias completas; gráfico y tabla coinciden | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa4.test.js`) |
| A16 | Calendario con teclado y tacto | Inspector de día, selector de rango explícito sin Shift | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa4.test.js`) |
| A17 | Años con máximos diferentes | Escala compartida por defecto; normalización identificada | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa4.test.js`) |
| A18 | Comparación con base cero y rango parcial | Sin NaN/Infinity; ventanas parciales advertidas; deltas exactos | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa5.test.js`) |
| A19 | Día/semana/mes y cambios DST | Sumas reconcilian sin perder ni duplicar scrobbles | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa5.test.js`) |
| A20 | Canción compartida por álbumes | Atribución específica y global agrupada diferenciadas | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa6.test.js`) |
| A21 | A→B→A, filtrado a A y pausas de días | Adyacencia seleccionada, original y de sesión diferenciadas | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa6.test.js`) |
| A22 | Sesiones unidas por un intervalo largo | Totales coherentes y detalle exacto de pertenencia | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa6.test.js`) |
| A23 | Primera aparición anterior, regreso dentro | No se reinicia descubrimiento ni se inventa pausa | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa7.test.js`) |
| A24 | Primera aparición cerca del final del historial | Seguimiento insuficiente explícito; no abandono supuesto | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa7.test.js`) |
| A25 | Exportar con filtros y búsqueda | Alcance, cantidad, orden y metadata; exporta todas las filas | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa8.test.js`) |
| A26 | HTML y caracteres especiales; CSV con prefijos de fórmula | Sin XSS y con neutralización de fórmulas | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa8.test.js`) |
| A27 | Guardado, carga y borrado con fallos | Persistencia consentida y errores recuperables | **Manual e integración pendientes** |
| A28 | Veinte ciclos de navegación/detalle/filtros | Sin fugas de memoria; heap acotado en ejecución continua | **Evidencia parcial en Node; integración/manual pendiente** (`test/acceptance-etapa8.test.js`) |
