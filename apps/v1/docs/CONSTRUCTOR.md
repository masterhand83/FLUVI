# 🏗️ Constructor de Mapas - Guía de Usuario

## Edificios rectangulares

Pulsa **▭ Edificio** (o **Agregar Edificio**) y arrastra de una esquina a la opuesta. Activa **Cuadrado** para bloquear ambas dimensiones. Al soltar se crea y selecciona un único edificio; su inspector permite cambiar nombre, posición, ancho, alto, ángulo y color inmediatamente, sin Guardar ni Cancelar. Los controles sobre el mapa permiten mover, redimensionar y girar.

Los edificios de forma usan una paleta fija: café `#A0522D`, gris `#6C757D`, azul `#1F4E9E`, cielo `#46B5D1`, verde `#2E7D32` y café heredado `#8B4513`. Los colores de mapas antiguos que no pertenezcan a esta paleta se conservan hasta elegir explícitamente una muestra.

## Edificios con imagen

Pulsa **Edificio con imagen** y elige un PNG, JPEG o WebP de hasta 5 MB. Los archivos incompatibles, demasiado grandes o dañados se rechazan antes de crear un edificio. Tras cargar la imagen, haz clic en el mapa para colocar su centro; se crea un único edificio con proporciones originales y una dimensión máxima inicial de 120 unidades del mapa. Escape cancela la colocación pendiente.

El inspector y los controles del mapa permiten mover, girar y cambiar el tamaño inmediatamente. Cambiar ancho o alto ajusta también la otra dimensión para no deformar la imagen; no hay conversión de modo ni Guardar/Cancelar. Su superficie de selección es rectangular, incluida la zona transparente de la imagen. El archivo JSON incluye los bytes de la imagen y la restaura tanto en Canvas como en Pixi, sin depender del archivo original.

## Estacionamiento funcional

Selecciona un edificio rectangular, poligonal o con imagen y activa **Estacionamiento funcional** en su inspector. Completa al menos un par de entrada/salida con calle, carril y celda válidos; los carriles y las celdas se numeran desde 1 en el inspector. Una celda no puede repetirse ni pertenecer a otro estacionamiento. Si falta información, el inspector explica qué corregir y el edificio no se vuelve funcional.

Los cambios válidos se aplican inmediatamente. Mientras corriges un par incompleto o inválido, las conexiones anteriores siguen activas. La capacidad debe ser un entero positivo y no puede ser menor que la ocupación actual; las probabilidades de entrada y salida se ajustan por hora. Desactivar estacionamiento no pide confirmación: elimina las conexiones y pone la ocupación en cero, sin cambiar la forma, imagen ni selección del edificio.

El borde azul identifica estacionamientos funcionales y permanece visible junto al borde de selección. Un nombre o imagen de estacionamiento por sí solo no activa esta función. Guardar y cargar JSON conserva la configuración válida en Canvas y Pixi.

## Descripción General

El Constructor de Mapas es una herramienta integrada en el Simulador de Tráfico FLUVI que te permite crear, editar, guardar y cargar simulaciones personalizadas desde cero.

## 📋 Características

### ✅ Gestión de Simulaciones
- **Nueva Simulación**: Crea una simulación en blanco
- **Guardar Simulación**: Exporta tu mapa como archivo JSON
- **Cargar Simulación**: Importa mapas guardados anteriormente
- **Imagen de referencia**: Usa una imagen local o enlaza su URL como guía, reemplázala o quítala

### ✅ Construcción de Mapas
- **Agregar Calles**: Crea calles personalizadas con todos sus parámetros
- **Agregar Conexiones**: Conecta calles con diferentes tipos de conexiones
- **Eliminar Calles**: Elimina calles seleccionadas del mapa

## 🎯 Cómo Usar

### 1. Crear una Nueva Simulación

1. Abre el accordion "🏗️ Constructor de Mapas"
2. Haz clic en "➕ Nueva Simulación"
3. Confirma que deseas crear una nueva simulación (esto limpiará el mapa actual)

### 2. Agregar Calles

1. Haz clic en "➕ Agregar Calle"
2. Se abrirá una serie de prompts para ingresar los parámetros:
   - **Nombre**: Nombre descriptivo de la calle (ej: "Av. Principal")
   - **Tamaño**: Número de celdas (ej: 100)
   - **Tipo**: GENERADOR, CONEXION o DEVORADOR
   - **Posición X**: Coordenada horizontal (ej: 500)
   - **Posición Y**: Coordenada vertical (ej: 500)
   - **Ángulo**: Rotación en grados (ej: 0, 90, 180, 270)
   - **Carriles**: Número de carriles (ej: 3)
   - **Probabilidad de generación**: 0.0 a 1.0 (ej: 0.5 para 50%)
   - **Probabilidad de cambio de carril**: 0.0 a 1.0 (ej: 0.02 para 2%)

3. La calle aparecerá en el canvas inmediatamente

Los carriles nuevos empiezan en sentido **Adelante**. Al seleccionar una calle en el mapa, el inspector muestra **Sentido por carril** en orden físico (1, 2, …). Pulsa la flecha de un carril para alternar entre adelante y reversa: el cambio pausa la simulación y conserva los vehículos en sus celdas actuales; pulsa Reanudar para seguir. Si aumentas carriles, los existentes conservan su sentido y los nuevos empiezan hacia adelante.

### Dibujar una glorieta

Pulsa **↻ Glorieta** y arrastra en el mapa desde su centro hasta el borde del **radio interior**. El centro se coloca exactamente donde presionas, incluso si hay otro objeto debajo de la isla; comprueba que la calzada no se solape con otras calles. Esc cancela; un radio inválido no crea ninguna calle. La glorieta es de tipo conexión, tiene de 1 a 10 carriles inicialmente en sentido horario y comienza vacía con un 2 % de probabilidad de cambio de carril. Selecciónala para editar el centro, el radio interior, el número de carriles y la probabilidad en el inspector. Pulsa **↻ / ↺** junto a cada carril para alternar entre sentido horario y antihorario; los vehículos conservan su celda y cambian su movimiento posterior. Los cambios de carril solo ocurren entre carriles con el mismo sentido. El número de celdas se calcula automáticamente a partir del radio y no se puede escribir directamente. En el mapa, arrastra la calzada para moverla o el control del borde derecho interior para cambiar el radio. Las conexiones no se crean automáticamente: usa **Crear enlace** para conectarla con otras calles. Los modos Calle, Glorieta y Crear enlace se excluyen mutuamente.

Al cambiar el radio, vehículos, enlaces, aparcamientos y marcas de escenario se trasladan al sector de ángulo equivalente; si varios ocupan el mismo sector nuevo, no es posible conservarlos todos. Reanuda explícitamente la simulación después de editar.

### 3. Agregar Conexiones

1. Asegúrate de tener al menos 2 calles creadas
2. Haz clic en "🔗 Agregar Conexión"
3. Sigue los prompts:
   - **Índice de calle origen**: Número de la calle de origen (se muestra una lista)
   - **Índice de calle destino**: Número de la calle de destino
   - **Tipo de conexión**: LINEAL, INCORPORACION o PROBABILISTICA

#### Tipos de Conexión

**LINEAL**: Conexión 1 a 1 entre carriles
- En **Crear enlace**, elige las calles de origen y destino y selecciona **Lineal**. Cada correspondencia permite escribir **Carril origen** y **Carril destino** (índices desde 0). Las parejas iniciales son carril 0 → carril 0, carril 1 → carril 1, etc., pero puedes cambiarlas.
- Usa **Añadir correspondencia** para conectar más carriles y **×** para quitar una pareja. En calles ordinarias se conecta la salida del carril de origen con la entrada del carril de destino según sus sentidos; en glorietas debes elegir las celdas explícitamente.
- Las flechas muestran las parejas antes de guardar. **Guardar** aplica todas las correspondencias válidas; **Cancelar** o Escape descartan el borrador. Puedes reabrir un enlace guardado desde la lista y cambiar sus carriles.
- No requiere parámetros adicionales

**INCORPORACION**: Múltiples carriles convergen en uno
- Requiere especificar el carril destino
- Requiere posición inicial en el destino
- Ideal para fusiones de tráfico

**PROBABILISTICA**: Conexión con probabilidad de transferencia
- Requiere especificar carril origen y destino
- Requiere probabilidad (0.0 a 1.0)
- Los vehículos se transfieren según la probabilidad especificada

Las conexiones nuevas usan por defecto la salida del carril origen y la entrada del carril destino; también admiten celdas interiores. Para conservar mapas antiguos, las conexiones explícitas en carriles hacia adelante pueden usar otras celdas, incluso extremos. En carriles en reversa no se permite salir por su entrada ni entrar por su salida. En el modal anterior las posiciones visibles empiezan en 1, pero el JSON guarda índices físicos desde 0: `posOrigen: -1` siempre significa la **última celda física**, no «salida». Una salida inversa en la primera celda se guarda explícitamente como `0`. Cambiar el sentido de un carril no borra conexiones existentes: **Ver Conexiones Existentes** marca las incompatibles en amarillo y permite editarlas.

### 4. Editar Calles

1. Selecciona el tipo de objeto "Calle" en el accordion de Configuración
2. Elige la calle del dropdown
3. Activa "Modo Edición" para moverla visualmente
4. O usa "Ajustes Avanzados" para modificar posición/ángulo manualmente

### 5. Eliminar Calles

Para dar forma a una calle seleccionada, pulsa **+ Añadir control** en el inspector y elige **Control Bézier** o **Ancla fija**. Los controles curvan una sección sin obligar a la calle a pasar por ellos; las anclas separan secciones y guían giros redondeados. La calle recorta la esquina cerca del ancla, sin pasar exactamente por ella; una sección sin controles es recta fuera del giro. Arrastra el control o el ancla en el mapa para cambiar su posición; el inspector no ofrece campos X/Y para estos puntos. Mover un control no desplaza las anclas; mover un ancla modifica sus dos secciones vecinas. Puedes eliminar el elemento seleccionado; al quitar un ancla se unen las secciones vecinas y puede cambiar la forma. Los extremos se pueden arrastrar; los campos X/Y de la calle y su ángulo mueven o giran toda la calle, y el número de celdas escala su forma desde el inicio. La longitud del recorrido determina el número de celdas (redondeado a la celda más cercana). Una previsualización inválida se señala y recupera la geometría anterior al soltar. Cruzar otra calle no crea una conexión de tráfico automáticamente. Reanuda la simulación explícitamente tras editar.

1. Selecciona la calle que deseas eliminar
2. Haz clic en "🗑️ Eliminar Calle Seleccionada"
3. Confirma la eliminación

### 6. Guardar Simulación

1. Haz clic en "💾 Guardar Simulación"
2. Ingresa un nombre para tu simulación
3. Se descargará un archivo JSON con toda la configuración

**El archivo JSON incluye:**
- Todas las calles con sus parámetros
- `laneDirections` por calle: un número por carril físico (`1` adelante, `-1` reversa). Los archivos antiguos sin este campo y los valores inválidos se cargan hacia adelante.
- Las glorietas incluyen `geometryType: "roundabout"`, `innerRadius` y `startAngle` (grados desde el eje X). Su tamaño se recalcula al cargar y `laneDirections` conserva el sentido de cada carril (`1`: horario, `-1`: antihorario; si falta, horario). Geometrías de glorieta inválidas se omiten; archivos antiguos sin marcador siguen siendo calles normales.
- Todas las conexiones
- Vértices de curvas heredadas o extremos y secciones Bézier con controles y anclas (si existen)
- Edificios (si existen)
- Metadata (versión, fecha, nombre)

### 7. Cargar Simulación

1. Haz clic en "📂 Cargar Simulación"
2. Selecciona un archivo JSON guardado anteriormente
3. Confirma que deseas cargar (esto reemplazará la simulación actual)
4. La simulación se cargará completamente con:
   - Todas las calles en sus posiciones originales
   - Todas las conexiones restauradas
   - Curvas y vértices restaurados
   - Edificios restaurados

### 8. Usar una imagen de referencia

1. En «🖼️ Imagen de referencia», selecciona **Cargar o reemplazar imagen** y elige un archivo de tu equipo, o introduce una URL y pulsa **Enlazar o reemplazar imagen**.
2. La primera imagen se centra en la vista y se ajusta proporcionalmente. Al reemplazarla se conserva su centro y se ajusta dentro del espacio anterior sin deformarse.
3. Ajusta **Opacidad** (la imagen nueva empieza al 70 %) o desmarca **Mostrar imagen de referencia** para ocultarla sin perder su posición.
4. Pulsa **Bloquear imagen para editar el mapa** para ocultar sus controles de alineación y poder seleccionar y arrastrar calles y edificios bajo ella. Desbloquéala desde el mismo botón para volver a moverla, girarla o cambiar su tamaño.
5. Pulsa **Quitar imagen** para retirarla del mapa.
6. Al guardar, la imagen local y sus ajustes se incrustan en el JSON. Una imagen enlazada guarda solo la URL y sus ajustes: depende de que la fuente siga disponible al cargar la simulación. Si no carga, aparece «Image unavailable» en su ubicación; puedes sustituir la URL sin perder la alineación. «Nueva Simulación» quita también la imagen.

## 📝 Formato del Archivo JSON

```json
{
  "version": "1.0",
  "nombre": "Mi Simulación",
  "fecha": "2025-10-09T12:00:00.000Z",
  "calles": [
    {
      "nombre": "Av. Principal",
      "tamano": 100,
      "tipo": "CONEXION",
      "x": 500,
      "y": 500,
      "angulo": 0,
      "probabilidadGeneracion": 0.5,
      "carriles": 3,
      "laneDirections": [1, -1, 1],
      "probabilidadSaltoDeCarril": 0.02,
      "vertices": [],
      "esCurva": false
    }
  ],
  "conexiones": [
    {
      "origenIdx": 0,
      "destinoIdx": 1,
      "tipo": "LINEAL",
      "detalles": [...]
    }
  ],
  "edificios": [...],
  "imagenReferencia": {
    "dataUrl": "data:image/png;base64,...",
    "x": 100,
    "y": 100,
    "width": 800,
    "height": 600,
    "rotation": 0,
    "visible": true,
    "opacity": 0.7,
    "locked": false
  }
}
```

Para una imagen enlazada, `imagenReferencia` contiene `"url": "https://ejemplo.org/mapa.png"` en lugar de `dataUrl`, junto con los mismos ajustes de posición y visualización.

## 💡 Consejos y Mejores Prácticas

### Planificación
1. **Dibuja tu mapa primero**: Boceta tu diseño en papel antes de empezar
2. **Usa nombres descriptivos**: Facilita identificar calles posteriormente
3. **Organiza por secciones**: Crea una sección a la vez (norte, sur, este, oeste)

### Posicionamiento
1. **Usa coordenadas múltiplos de 50**: Facilita alinear calles
2. **Ángulos comunes**: 0°, 90°, 180°, 270° para calles ortogonales
3. **Verifica con Modo Edición**: Usa el modo edición para ajustar posiciones visualmente

### Conexiones
1. **Conecta en orden lógico**: Sigue el flujo del tráfico
2. **Verifica los índices**: Usa "Mostrar Conexiones" para verificar visualmente
3. **Prueba las probabilísticas**: Ajusta las probabilidades para balancear el tráfico

### Guardar/Cargar
1. **Guarda versiones**: Crea múltiples versiones de tu mapa (v1, v2, v3)
2. **Usa nombres descriptivos**: "campus_norte_v2.json" es mejor que "mapa1.json"
3. **Respaldo regular**: Guarda frecuentemente durante la construcción

## 🐛 Solución de Problemas

### La calle no aparece
- Verifica que las coordenadas estén dentro del canvas
- Usa el scroll/zoom para encontrarla
- Revisa el minimapa para ubicación global

### Las conexiones no funcionan
- Asegúrate de que los índices sean correctos
- Verifica que las calles estén suficientemente cerca
- Usa "Mostrar Conexiones" para verificar visualmente

### Error al cargar JSON
- Verifica que el archivo sea un JSON válido
- Asegúrate de que tenga la estructura correcta
- Verifica que la versión sea compatible (v1.0)

### Simulación se comporta extraño
- Reinicializa intersecciones desde la consola: `inicializarIntersecciones()`
- Verifica probabilidades (deben estar entre 0 y 1)
- Revisa que no haya calles superpuestas sin intersecciones

## 🚀 Funciones Avanzadas

### Edición de JSON Manual
Puedes editar el archivo JSON manualmente para:
- Ajustar posiciones de múltiples calles
- Copiar/pegar secciones de mapas
- Crear patrones repetitivos

### Importar Secciones
1. Guarda diferentes secciones como archivos separados
2. Combínalos manualmente en un editor de texto
3. Ajusta los índices de conexiones

### Plantillas
Crea plantillas de patrones comunes:
- Intersección en T
- Rotonda
- Autopista con salidas
- Red urbana básica

## 📞 Soporte

Para más ayuda, consulta:
- Modal de instrucciones (botón 📚 Ver Guía Completa)
- CLAUDE.md para arquitectura del código
- Consola del navegador para mensajes de debug

---

**Versión**: 1.0
**Última actualización**: Octubre 2025
**Compatibilidad**: Simulador de Tráfico FLUVI v1.0+
