# Cambios relevantes de FLUVI v1

Resumen del historial de Git de `apps/v1`, hasta el commit `4f4d71d` (1 de octubre de 2026). Se incluyen cambios confirmados, sin modificaciones locales pendientes ni funcionalidades revertidas.

## Calles y glorietas

- Puedes dibujar calles rectas sobre el mapa y editar sus extremos y dimensiones con controles directos; las ediciones estructurales pausan la simulación.
- Puedes crear calles curvas Bézier y ajustar sus puntos de control y anclajes para suavizar esquinas.
- Puedes dibujar y editar glorietas, ajustar su radio y definir el sentido de circulación de cada carril, también en calles convencionales.

## Conexiones entre calles

- Puedes crear y editar enlaces lineales, de incorporación y probabilísticos seleccionando calles y celdas sobre el mapa, con flechas de previsualización antes de guardar.
- Puedes elegir qué carriles conectar en los enlaces de incorporación.

## Edificios y estacionamientos

- Puedes crear edificios rectangulares o poligonales y modificar su posición, tamaño, rotación y color directamente en el mapa.
- Puedes usar imágenes propias como edificios, reemplazarlas y guardarlas dentro del archivo del mapa, conservando la compatibilidad con las imágenes originales.
- Puedes configurar estacionamientos desde el inspector de edificios y distinguir los edificios con conexiones de estacionamiento funcionales.
- Puedes eliminar edificios sin dejar conexiones de estacionamiento huérfanas; al simular entradas al estacionamiento, ya no se duplican vehículos.

## Generación de vehículos

- Puedes activar o desactivar la generación de vehículos por carril y conservar esa configuración al guardar el mapa.
- Puedes aplicar un porcentaje global de generación de vehículos sin modificar los porcentajes individuales de las calles.

## Escenarios y lluvia

- Puedes activar lluvia aleatoria y ajustar la probabilidad de inundar celdas vacías, sin sobrescribir vehículos ni obstáculos.

## Métricas, análisis y exportación

- Puedes consultar métricas que distinguen vehículos de obstáculos y una tasa neta de población que refleja aumentos y disminuciones según el tiempo simulado.
- Puedes consultar un mapa de calor basado en la densidad local de vehículos, sin contar obstáculos como automóviles.
- Puedes exportar un ZIP con imágenes de las gráficas, un resumen del estado del tráfico y el mapa de calor.
- Puedes exportar las gráficas como imágenes con todo el historial registrado, en lugar de limitarte a las últimas mediciones.
- Puedes analizar archivos de métricas sin arrastrar resultados de sesiones anteriores y cambiar correctamente entre las pestañas del analizador.

## Imágenes de referencia

- Puedes añadir una imagen de referencia desde un archivo o una URL y alinearla mediante desplazamiento, escala y rotación.
- Puedes ajustar su visibilidad y opacidad, bloquearla durante la edición y reconocer los enlaces de imagen no disponibles.

## Interfaz y gestión de mapas

- Puedes acceder a las herramientas de dibujo desde una sección dedicada de la barra lateral y elegir calles en listas ordenadas alfabéticamente.
- Puedes mostrar nombres de calles y edificios, ajustar su tamaño y mantenerlos legibles al cambiar el zoom.
- Puedes consultar información más clara al pasar el cursor sobre celdas y gráficas, y ver los FPS medidos de la simulación en la barra de información.
- Puedes crear o cargar un mapa sin conservar vehículos, métricas, escenarios ni zonas de fondo de la sesión anterior.
- Los desarrolladores mejoraron la accesibilidad de botones y ventanas de diálogo.

## Desarrollo y pruebas

- Los desarrolladores incorporaron la aplicación v1 al repositorio y prepararon la configuración de desarrollo.
- Los desarrolladores añadieron pruebas de referencia del comportamiento del tráfico.
