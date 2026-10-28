# Seguimiento de Implementación — Scrobbleview

## 1. Identificación y Estado Base

- **Fecha de inicio**: 28 de octubre de 2026.
- **Entorno**: Termux en Android (aarch64, bionic, Node v26.12.1).
- **Repositorio**: `/data/data/com.termux/files/home/proyectos/scrobbleview`
- **Rama de trabajo**: `feat/deepening-plan` (bifurcada desde `main`).
- **HEAD inicial**: `4aa7023c14ded79bd6564529457aec55ef67e1ab` ("ignore local data and tighten JSON exceptions").
- **Estado del árbol de trabajo**: Limpio, sin modificaciones previas sin registrar.

## 2. Verificación de Partida

### Suite de pruebas unitarias y de integración (`node --test`)
- **Total ejecutado**: 235 pruebas.
- **Aprobadas**: 235.
- **Fallidas**: 0.
- **Duración**: 13,29 s.

### Benchmark base (100.000 eventos compactos)
- Comando: `node --expose-gc bench/aggregate.js 100000 --compact`
- Eventos: 100.000.
- Tracks únicos: 10.000.
- Records procesados: 50.000.
- Tiempo de agregación: 1652 ms.
- Tiempo de filtrado: 1018 ms.
- Tiempo de conteo: 1 ms.
- Pico de memoria RSS: 235 MiB.

### Estado de la regresión de navegador (`browser-tests/navigation.js`)
- **Fallo previo identificado**: Línea 89 evalúa `comparison.includes('+100')` cuando la interfaz actual renderiza `▲ 100%`. Requiere actualizar la aserción de formato en Etapa 1 sin alterar la lógica de cálculo.

## 3. Inventario de Conservación del Sistema Existente

Ninguno de los siguientes componentes, métricas o capacidades puede ser removido o deshabilitado durante las etapas de desarrollo:

### 3.1. Vistas y Secciones (8 principales + 3 fichas de detalle)
1. **Resumen (`dashboard`)**:
   - KPIs: Reproducciones, Tiempo escuchado, Artistas, Canciones, Álbumes, Sesiones, Racha más larga, Duración promedio, Final con código trackdone, Saltadas, En aleatorio, Sin conexión, Reproducciones significativas, Reproducciones cortas.
   - Gráficos: Actividad día × hora (heatmap + tabla accesible), Evolución mensual (lineChart), Distribución de duración (hbarChart).
   - Componentes: Récords (recordsGridHTML), Rankings con tabs accesibles APG (Artistas, Canciones, Álbumes), Tablas con límite (Obsesión, Rachas, Mayor tasa de salto artistas/canciones, Menor tasa de salto artistas/canciones, Primera/Última canción del día).
2. **Horarios (`hours`)**:
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
   - Tablas: Sesiones más largas por duración y por reproducciones.
5. **Descubrimiento (`discovery`)**:
   - KPIs: Primeras apariciones, Escuchas de catálogo, Promedio por mes activo, Artistas únicos.
   - Gráfico: Canciones nuevas por mes.
   - Tablas: Meses con más descubrimientos, Meses con mayor proporción de nuevas, Constancia (cobertura activa intermensual), Longevidad de artistas.
6. **Años (`yearly`)**:
   - Tabla anual con enlaces al calendario, tiempo, reproducciones, artistas, canciones, álbumes, descubrimientos, top artista, top canción, saltadas y rachas.
   - Gráfico apilado por bloques horarios por año.
7. **Calendario (`calendar` / `calendar/:year`)**:
   - Índice general de años y vista de año individual.
   - Vista anual panorámica con escala de intensidad accesible y selector interactivo de días para filtrado.
8. **Resumen del período (`wrapped`)**:
   - Hero card con arquetipo de oyente.
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
- Modos de reproducción: Shuffle (Cualquiera / Solo aleatorio / Solo secuencial), Offline (Cualquiera / Solo sin conexión / Solo online), Skips (Cualquiera / Solo saltadas / Solo completadas).
- Umbrales configurables: reproducción significativa (`minMs`, default 30s) y reproducción corta (`skipThresholdMs`, default 10s).

### 3.3. Exportación y Almacenamiento
- Exportación JSON completa (`modelToJSON`).
- Exportación ZIP con 7 tablas CSV (`totals`, `artists`, `tracks`, `albums`, `album_tracks`, `sessions`, `monthly`) con escape y neutralización de fórmulas CSV.
- Formato recibo de texto plano para portapapeles.
- Caché IndexedDB opcional con consentimiento explícito y versión de esquema 2.

## 4. Matriz de Etapas del Plan

| Etapa | Descripción | Estado |
|---|---|---|
| **0** | Reconocimiento, base y seguimiento | **Completada** |
| **1** | Correcciones de lectura y definiciones | Pendiente |
| **2** | Contexto, rutas, espera y cancelación | Pendiente |
| **3** | Catálogo completo y tablas reutilizables | Pendiente |
| **4** | Gráficos y calendario accesibles | Pendiente |
| **5** | Comparación A/B y evolución | Pendiente |
| **6** | Día, sesiones y secuencias explicables | Pendiente |
| **7** | Descubrimiento, regresos y hábitos longitudinales | Pendiente |
| **8** | Exportación, personalización y cierre de calidad | Pendiente |

## 5. Siguiente Tarea Exacta

- Iniciar **Etapa 1 — Correcciones de lectura y definiciones**:
  1. Corregir la cascada responsive en `css/style.css` (reubicar reglas móviles de `.kpis` y `.records-grid` posteriores a las definiciones generales).
  2. Preservar dos columnas útiles en móvil para KPIs y récords sin desborde ni cortes.
  3. Normalizar redondeo de duración en `src/charts.js` (`fmtMs` y cálculo de unidades).
  4. Formatear rangos de intervalos en `src/aggregate/impl/totals.js` y `app/views.js`.
  5. Separar artistas identificados de artistas desconocidos en `src/aggregate/impl/temporal.js` y `app/views.js` (anual).
  6. Documentar constancia: continuidad activa vs. cobertura del período observado.
  7. Ajustar etiquetas de motivos de fin de evento en `app/views.js`.
  8. Aclarar denominadores de tasas y mínimos en rankings.
  9. Corregir aserción en `browser-tests/navigation.js:89`.
