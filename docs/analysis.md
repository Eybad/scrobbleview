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

## Verificación pendiente en navegador

`node --test` incluye comunicación real entre hilos, cancelación, errores, recuperación, respuestas fuera de orden y vistas renderizadas con la proyección del Worker. No equivale a probar el DOM, CSP, gestos o tecnologías de asistencia de un navegador.

Abrí `browser-tests/navigation.html` por HTTP para verificar carga, filtros, Atrás/Adelante, cambios manuales del hash, salto al contenido y cancelación. Probá además carga ZIP, detalle de álbum, selección de año, guardado/borrado y exportación. Esta implementación no se ha ejecutado en un motor de navegador durante esta sesión; tampoco se utilizó un historial personal.

## Cobertura de la auditoría

| Hallazgo | Implementación y evidencia |
| --- | --- |
| F01 | Restauración URL → estado → modelo y rechazo de respuestas obsoletas; regresión de navegador preparada, ejecución manual pendiente. |
| F02 | Intervalos UTC estimados, suma escuchada independiente, pistas largas y solapamientos cubiertos por regresiones. |
| F03 | Relación álbum–canción en fichas, series, minigráficos y CSV; agrupación global por título/artista conservada. |
| F04 | Orden UTC e índice local separado, con regresiones para DST. |
| F05 | Conteos directos, derivados reutilizados, modelo compacto, detalle diferido, Worker con progreso y cancelación; memoria todavía considerable. |
| F06 | Gramática, UTF-8, escapes, timestamps e identidad canónica; corpus diferencial contra JSON.parse. |
| F07 | Bits de validez, filtros y tasas con desconocidos, exclusión de duraciones desconocidas y caché compatible. |
| F08 | Definiciones explícitas, trackdone separado, descubrimiento histórico y períodos observados. |
| F09 | Ancla con foco y sin navegación del router; verificación de teclado real pendiente. |
| F10 | Título y etiquetas según año completo o período efectivo. |
| F11 | Node ≥24 declarado, ejecución local con 26.12.1; detección real del formato ZIP y alternativas probadas. |
| F12 | Defaults compartidos y la misma fachada para fuentes y datasets parseados. |
| F13 | Archivos repetidos, avisos de solapamiento, límites de recursos y fallos de caché cubiertos por regresiones. |

Se conservaron el formato estático, el procesamiento local y la ausencia de build/dependencias. No se aplicaron las preferencias estéticas de la sección «Interfaz y móvil» de la auditoría.
