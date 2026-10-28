# Seguimiento de Implementación — Scrobbleview

## 1. Identificación y Estado Base

- **Fecha de inicio**: 28 de octubre de 2026.
- **Entorno**: Termux en Android (aarch64, bionic, Node v26.12.1).
- **Repositorio**: `/data/data/com.termux/files/home/proyectos/scrobbleview`
- **Rama de trabajo**: `feat/deepening-plan` (bifurcada desde `main`).
- **HEAD inicial**: `4aa7023c14ded79bd6564529457aec55ef67e1ab` ("ignore local data and tighten JSON exceptions").
- **Estado del árbol de trabajo**: Limpio, sin modificaciones previas sin registrar.

## 2. Verificación de Partida y Progreso

### Suite de pruebas unitarias y de integración (`node --test`)
- **Baseline inicial**: 235 pruebas (13,29 s).
- **Estado actual tras Etapa 1**: 240 pruebas aprobadas, 0 fallidas (10,60 s).

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
| **2** | Contexto, rutas, espera y cancelación | Pendiente |
| **3** | Catálogo completo y tablas reutilizables | Pendiente |
| **4** | Gráficos y calendario accesibles | Pendiente |
| **5** | Comparación A/B y evolución | Pendiente |
| **6** | Día, sesiones y secuencias explicables | Pendiente |
| **7** | Descubrimiento, regresos y hábitos longitudinales | Pendiente |
| **8** | Exportación, personalización y cierre de calidad | Pendiente |

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

## 6. Siguiente Tarea Exacta

- Iniciar **Etapa 2 — Contexto, rutas, espera y cancelación**:
  1. Implementar la separación tripartita del estado (analítico, consulta, retorno).
  2. Implementar rutas semánticas versionadas (tipo + entidad) con resolución a IDs internos y recuperación explícita para enlaces legados o inexistentes.
  3. Guardar/restaurar posición de scroll y foco mediante `history.state`.
  4. Enlaces jerárquicos y contextuales transportables entre pestañas.
  5. Franja contextual compacta en móvil (≤ 2 filas) e índice local de secciones.
  6. Unificación de métrica (*Tiempo escuchado* / *Reproducciones*) en todo el flujo.
  7. Coalescencia de solicitudes analíticas en vuelo hacia el Worker.
  8. Feedback de "Actualizando" preservando último estado confirmado.
  9. Manejo diferenciado de errores y cancelación lógica de tareas.
