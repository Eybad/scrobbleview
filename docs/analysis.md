# Estadísticas y rendimiento

## Definiciones

- **Reproducciones:** todos los eventos musicales aceptados, incluidas las reproducciones cortas. Los podcasts y los registros sin fecha o canción utilizables se excluyen con avisos.
- **Tiempo escuchado:** suma de `ms_played` conocidos. Un valor nulo, ausente, negativo, fraccionario o mayor que 24 horas se trata como desconocido; una duración inválida genera además `BAD_MS`.
- **Significativas y cortas:** duraciones conocidas ≥30 s y <10 s por defecto. Las cortas permanecen en los totales y rankings; `skipped` es una bandera independiente. La [documentación de Spotify](https://support.spotify.com/us/artists/article/how-your-streams-are-counted/) respalda el umbral de 30 s para streams, sin acreditar que estas estadísticas reproduzcan su metodología completa.
- **Medias, mediana y distribución:** solo usan duraciones conocidas. Los porcentajes de skip, shuffle y offline usan registros donde la bandera respectiva es conocida. No hay equivalencia entre «desconocido» y cero/false; la interfaz muestra los conteos excluidos y `totals.csv` conserva esos denominadores. Los CSV de entidades incluyen `duration_known`. Las entidades sin ninguna duración conocida quedan fuera de HHI, Gini, entropía y número efectivo; Hábitos muestra sus conteos excluidos.
- **Finales:** `completed` conserva por compatibilidad el conteo de `reason_end === 'trackdone'`; `interrupted` cuenta los demás códigos presentes, sin afirmar que sean interrupciones. `endReasonUnknown` cuenta motivos ausentes. `endplay` no se equipara con una canción completada. La interfaz etiqueta literalmente `trackdone`.
- **Descubrimiento:** primera aparición de la canción agrupada o artista en todo el historial cargado. Filtrar no reinicia esa primera aparición. El promedio es por mes activo, aunque el gráfico represente con cero los meses vacíos. Ningún export demuestra cuándo conociste una canción.
- **Días sin registros:** días vacíos entre la primera y última escucha del subconjunto. No representan automáticamente todo el mes o año seleccionado, ni prueban ausencia de escucha.

## Identidad y tiempo

La canción se agrupa por título y artista; se permite juntar versiones con distintos URI. El álbum se identifica por artista y nombre. Cada relación álbum–canción mantiene sus propios totales y evolución. En `tracks.csv`, `album_id` es cero cuando no hay una única atribución conocida para todos los eventos; `album_tracks.csv` conserva la relación exacta.

Los eventos se recorren en orden UTC. Fecha, hora y día locales sirven para mostrar y agrupar; un índice local separado permite filtrar ambas ocurrencias de una hora repetida durante DST. Las primeras escuchas y transiciones siguen la cronología real.

Según los [campos del historial de Spotify](https://support.spotify.com/us/article/understanding-your-data/), el timestamp representa el final de una reproducción. El inicio se estima restando los milisegundos conocidos al final UTC; si no se conoce la duración, solo se conoce el final. Los intervalos conectados por pausas de hasta 30 minutos forman una sesión. Un intervalo largo puede unir sesiones anteriores.

La **duración estimada** es la amplitud UTC entre el inicio estimado más temprano y el último final; el **tiempo escuchado** es una suma independiente. Los solapamientos se suman y pueden superar esa amplitud. El archivo no permite reconstruir pausas internas ni demostrar simultaneidad. `sessions.csv` incluye tiempos UTC y conserva el inicio local legible.

Los timestamps se almacenan en segundos enteros y admiten hasta `2038-01-19T03:14:07Z`; una fecha inválida o fuera del rango genera `BAD_TS`. Las fracciones de segundo se omiten.

## Entrada y almacenamiento

La gramática JSON y UTF-8 se validan incluso en campos descartados; estos valores no se materializan. Las strings con escapes se comparan por su valor decodificado. Las fuentes se concatenan, sin deduplicar eventos por nombre y timestamp. Un solapamiento temporal es un aviso de posibles duplicados, sin demostrar que los haya.

La lectura limita bytes, eventos, longitud de tokens y anidamiento. El ZIP limita su directorio y sus entradas, y verifica tamaño descomprimido real y CRC. No admite Zip64 ni cifrado. Un archivo malformado, un error de tipos o un límite agotado abortan la carga entera; los avisos por registros no utilizables quedan en los metadatos.

La caché es opcional y descartable. Errores de apertura o transacción se informan como fallo de guardado/borrado o ausencia de una caché utilizable. No se anuncia borrado exitoso antes de confirmar la transacción. La serialización conserva identidades Unicode y rechaza diccionarios con conteos o rangos inválidos. Las cachés anteriores a los bits de validez no se reinterpretan como si sus flags fueran conocidos: hay que reimportar los archivos.

## Exportación y contexto confirmado

La exportación de tabla usa la misma descripción de catálogo que el render: selección analítica, búsqueda, campos buscados, elegibilidad, orden y desempates. El Worker exporta todas las coincidencias sin paginación; la posición y cuota mantienen sus denominadores de catálogo completos. El ZIP de tabla separa `<tab>.csv` de `metadata.csv`, para que la metadata no altere el formato tabular. La metadata declara versión/esquema, zona horaria, alcance, filtros y rangos, métrica y unidad, elegibilidad, denominadores y definiciones de ranking/cuota.

El diálogo toma el conteo y la dirección efectiva del resultado ya renderizado. Si no encuentra ese resultado, deshabilita la opción de tabla y muestra un mensaje recuperable en vez de recalcular el catálogo. Cancelar exportaciones concurrentes invalida sus respuestas sin terminar el Worker ni descartar el dataset. Las pruebas de Node leen el ZIP generado por el Worker, revisan CRC y comparan filtros, cantidad y filas con la consulta. El harness de navegador comprueba el inicio de descargas y su cancelación; son verificaciones complementarias.

Copiar resumen toma modelo, período y métrica del último contexto confirmado. Restablecer preferencias elimina ajustes visuales persistidos y sincroniza URL/controles conservando filtros analíticos, historial en memoria e IndexedDB. Las pruebas de Node cubren los estados de almacenamiento con un IndexedDB simulado; el harness de navegador comprueba consentimiento, guardado, carga y borrado con IndexedDB real.

## Procesamiento y memoria

La aplicación ejecuta lectura, preparación de zona horaria, agregación, filtros y exportación en un [Worker de módulo](https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker). La comparación anterior calcula solo conteos y tiempo. Los cambios de vista o de controles de tabla reutilizan las estadísticas cuando los filtros no cambian.

El Worker conserva el dataset, los índices derivados y las primeras apariciones históricas; entrega a la interfaz una proyección del modelo sin columnas por evento. No conserva una copia del modelo global completo. El modo compacto omite mapas de entidades por día y descarta mapas de sesión tras calcular sus métricas. Las relaciones de canciones de un álbum se calculan al pedir la ficha y se liberan al salir. La fachada de desarrollo mantiene el modelo completo por defecto.

El progreso se expresa por fase. Cancelar [termina el Worker](https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate), invalida respuestas pendientes y vuelve a la carga; no borra IndexedDB. El renderizado y la recepción del modelo siguen teniendo un costo en el hilo de interfaz. Un Worker mejora la disponibilidad de ese hilo y no elimina el costo de cómputo o memoria.

**23 B/evento describe solo las columnas del dataset.** Hay que añadir diccionarios, derivados, modelos, mapas, sets, distribuciones y buffers de exportación. Los límites de entrada no son una garantía de memoria disponible.

### Mediciones locales del 26 de octubre de 2026

Node.js 26.12.1 en este entorno Termux. Corridas individuales en procesos separados, con GC explícito antes de medir. Sin lectura JSON, construcción de zona IANA, mensajes Worker ni renderizado de navegador. Se conservan el modelo global y el de la mitad del historial; el pico RSS incluye runtime, generación columnar, índices y modelos.

Datos sintéticos: 500 artistas, `min(50.000, eventos/10)` canciones, reproducciones de 120 s en bloques de 100, con 28.800 s de pausa entre bloques; zona fija UTC−4. El filtro toma la mitad temporal final. [Benchmark reproducible](../bench/aggregate.js).

| Variante | Eventos | Agregación | Filtro de la mitad | Solo conteos | Pico RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Antes de reutilizar derivados | 100.000 | 2,04 s | 1,03 s | No aislado | 272 MiB |
| Derivados reutilizados, modelo completo | 100.000 | 1,76 s | 1,24 s | 3 ms | 270 MiB |
| Compacto, detalle de álbum diferido | 100.000 | 2,16 s | 1,64 s | 1 ms | 216 MiB |
| Compacto, detalle de álbum diferido | 500.000 | 8,29 s | 4,86 s | 5 ms | 746 MiB |

Estas muestras muestran un menor pico RSS en la corrida compacta. El conteo directo evita calcular modelos enteros para comparar totales. Las muestras no prueban una mejora uniforme de tiempos de filtrado. No son promedios, una ley de escalado ni predicciones para otro teléfono. El consumo sigue siendo alto en historiales grandes; conviene cargar períodos más pequeños si el navegador no dispone de recursos suficientes.

### Comparación local de versiones (29 de octubre de 2026)

Comando: `node --expose-gc bench/r10.js 100000 5`. La comparación se ejecutó en Termux/Android aarch64 con Node v26.12.1. Ambas versiones usaron el mismo fixture sintético: 100.000 eventos, 10.000 canciones, 500 artistas, 500 álbumes, 23.133.801 bytes JSON y rango `2020-01-01T00:00:00.000Z..2021-04-16T21:18:00.000Z`. Se tomaron cinco muestras por operación; la tabla informa mediana y peor muestra. La prueba se limitó a 100.000 eventos porque un proceso alcanzó 407,8 MiB de RSS en Android.

| Operación | Versión anterior: mediana / peor (ms) | Versión medida: mediana / peor (ms) |
| --- | ---: | ---: |
| Parseo | 2.262,58 / 2.340,47 | 2.262,18 / 2.399,09 |
| Derivación + agregación compacta | 1.998,25 / 2.186,22 | 2.134,86 / 2.387,23 |
| Clonado de proyección (`structuredClone`) | 1.345,46 / 1.361,22 | 2.384,17 / 2.386,37 |
| Consulta de catálogo | 11,80 / 44,84 | 12,92 / 37,53 |
| Render de catálogo a HTML | 18,41 / 46,88 | 19,84 / 50,49 |
| CSV + ZIP de tabla | 133,56 / 465,60 | 153,40 / 475,38 |
| RSS pico del proceso | 359,3 MiB | 407,8 MiB |

En esta comparación, parseo y consulta quedaron cerca de la base; derivación/agregación, render y exportación fueron algo más lentos. El clonado de la proyección y el RSS aumentaron de forma clara. Consulta y render quedaron debajo de 200 ms en estas muestras Node, pero eso no mide latencia del DOM ni respuesta visual en navegador. `structuredClone` representa el costo de copiar la proyección, no el mensaje real de un Worker; el render solo produce un string y no construye el DOM; la exportación mide la tabla sintética y su ZIP. La medición no demuestra el objetivo de feedback de 100 ms ni la RAM disponible para un historial personal. Las corridas son sensibles a la carga y temperatura del dispositivo.

El 29 de octubre se ejecutó además una corrida compacta de 500.000 eventos: `node --expose-gc bench/aggregate.js 500000 --compact`. Con 50.000 canciones sintéticas registró 11.624 ms de agregación, 8.619 ms de filtro, 6 ms de conteo y 802 MiB de RSS pico. Es una muestra aislada sin lectura JSON, construcción de zona IANA, Worker ni renderizado; no es comparable con la tabla de versiones de 100.000 eventos ni sustituye la carga de 500.000 eventos en navegador.

## Verificación de navegador y pendientes manuales

`node --test` incluye comunicación real entre hilos, cancelación, errores, recuperación, respuestas fuera de orden y vistas renderizadas con la proyección del Worker. No equivale a probar el DOM, CSP, gestos o tecnologías de asistencia de un navegador.

El 29 de octubre se completaron diez ejecuciones aprobadas de `browser-tests/navigation.html` por HTTP local en Chromium 156.0.8078.47, Android/Termux aarch64, con ocho eventos sintéticos; no se usaron historiales personales. Todas cubrieron carga, filtros, Atrás/Adelante y cambios de hash, búsqueda/caret, accesibilidad de nombres/tablas, cinco fichas, comparación con base cero, los tres alcances de exportación, reset de preferencias, series de gráfico y veinte ciclos de navegación/detalle/filtros. Las cuatro últimas también cubrieron IndexedDB del navegador, nueva pestaña con datos guardados, scroll real y cancelación de exportación. No se observaron excepciones JavaScript. El harness registró 120 efectos de acción y 60 cambios de ruta por corrida.

| Ancho del iframe | 320 px | 360 px | 393 px | 412 px | 640 px |
| --- | ---: | ---: | ---: | ---: | ---: |
| `scrollWidth` | 320 | 345 | 378 | 397 | 625 |

Todos los anchos quedaron dentro del viewport. En el resumen, KPIs y récords conservaron dos columnas en cada ancho; `scrollWidth` y `scrollHeight` no detectaron texto desbordado en etiquetas ni valores. Con la raíz al 125 %, el tamaño calculado fue 20 px, sin desborde de página o de esos textos. En la prueba de historial se restauraron `scrollY=250` y `scrollLeft=180` de la tabla; se inyectó ancho de tabla solo para forzar overflow reproducible. Esto no comprueba cada control visual ni el scroll de mapas. La navegación por Tab dejó foco en «Explorar» con `:focus-visible`, contorno sólido de 2 px y sin otro elemento encima.

Cinco ejecuciones con GC forzado midieron deltas de heap `performance.memory` de +100.270, +95.242, +95.422, +91.070 y +100.717 bytes tras los veinte ciclos. Las otras cinco ejecuciones no forzaron GC y no se mezclan con esa serie. Las muestras intermedias fueron variables y no monotónicas. Esto limita la conclusión a este flujo: no demuestra ausencia general de fugas ni mide toda la RAM del navegador.

El harness descargó y se inspeccionaron tres ZIP reales del navegador. Los tres pasan CRC: `all` contiene 8 eventos y las siete tablas; `selection` contiene 4 eventos y las siete tablas; `table` contiene 8 eventos, `catalog.search=Echo`, dos coincidencias y las filas Echo/Artist A y Echo/Artist B. La comprobación también confirmó `metadata.csv` y no encontró `undefined` como valor de metadata.

Las cuatro ejecuciones extendidas guardaron ocho eventos tras consentimiento, reabrieron el dataset en una pestaña nueva con `s=unknown` y `m=plays`, borraron todas las claves y comprobaron un error real de versión de IndexedDB sin dejar caché parcial ni perder el análisis en memoria. Una exportación activa se canceló antes de recibir la respuesta del Worker; durante un segundo no se llamó al enlace de descarga.

Siguen pendientes comprobaciones con TalkBack y tacto físico, scroll de mapas/calendario, revisión visual del resto de controles, consola/CSP en otros navegadores y carga de 500.000 eventos en navegador. El harness usa teclado/CDP y clic sintético; no sustituye esas pruebas.

## Alcance de las pruebas

La suite `node --test` verifica el parsing, las métricas, las rutas, las vistas y los recorridos del Worker con datos sintéticos. Las mediciones de esta página son corridas locales fechadas; documentan el método y un resultado observado, no una garantía de rendimiento para otros dispositivos.

El harness `browser-tests/navigation.html` cubre recorridos representativos en Chromium. La interacción con lectores de pantalla y tacto físico, y el comportamiento en otros motores, requieren pruebas manuales adicionales. La suite y el harness no acreditan por sí solos conformidad integral con WCAG.
