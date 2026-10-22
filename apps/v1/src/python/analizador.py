import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from scipy import stats, signal
from datetime import datetime, timedelta
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')
import io
import base64
import json
import re

IDIOMAS_ANALIZADOR = ('es', 'en')
DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
CLAVES_DIAS_SEMANA = [
    'weekdays.monday', 'weekdays.tuesday', 'weekdays.wednesday',
    'weekdays.thursday', 'weekdays.friday', 'weekdays.saturday',
    'weekdays.sunday',
]
ESTADOS_MENSAJE = {
    '🔵 Sub-utilizado': 'states.underused',
    '🟡 Moderado': 'states.moderate',
    '🟢 Óptimo': 'states.optimal',
    '🟠 Congestionado': 'states.congested',
    '🔴 Colapso': 'states.collapse',
}
PLACEHOLDER_PATTERN = re.compile(r'\{\{\s*([^{}\s]+)\s*\}\}')


def _cargar_mensajes_analizador():
    """Carga los mensajes del analizador inyectados o junto a este archivo."""
    inyectado = globals().get('FLUVI_ANALYZER_MESSAGES_JSON')
    if inyectado:
        try:
            mensajes = json.loads(inyectado)
            if isinstance(mensajes, dict):
                return mensajes
        except (TypeError, ValueError):
            pass

    archivo = globals().get('__file__')
    if archivo:
        try:
            ruta = Path(archivo).with_name('analizador-mensajes.json')
            with ruta.open(encoding='utf-8') as manejador:
                mensajes = json.load(manejador)
            if isinstance(mensajes, dict):
                return mensajes
        except (OSError, ValueError):
            pass
    return {}


def _aplicar_placeholders(texto, params):
    return PLACEHOLDER_PATTERN.sub(
        lambda match: str(params.get(match.group(1), match.group(0))),
        str(texto),
    )


MENSAJES_ANALIZADOR = _cargar_mensajes_analizador()


class ErrorAnalizador(ValueError):
    """Error visible al usuario, ya traducido al idioma activo."""

# Importar seaborn solo si está disponible
try:
    import seaborn as sns
    SEABORN_AVAILABLE = True
except ImportError:
    SEABORN_AVAILABLE = False
    print("⚠️ Seaborn no disponible, usando matplotlib por defecto")

# Importar sklearn solo si está disponible
try:
    from sklearn.cluster import KMeans
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    print("⚠️ Scikit-learn no disponible")

class AnalizadorTraficoFLUVI:
    IDIOMAS = IDIOMAS_ANALIZADOR

    def __init__(self, archivo, tipo='csv', idioma='es'):
        """Inicializa el analizador y carga los datos

        Args:
            archivo: Archivo o contenido a procesar (CSV o JSON)
            tipo: 'csv' o 'json' - tipo de archivo a procesar
            idioma: 'es' o 'en' - idioma de las gráficas y mensajes visibles.
                Al omitirlo se conserva la salida en español.
        """
        self.idioma = idioma if idioma in self.IDIOMAS else 'es'
        self.df = self.cargar_datos(archivo, tipo)
        self.resultados = {}

    def _texto(self, clave, **params):
        """Devuelve un mensaje del idioma activo con respaldo en español."""
        completo = f'analyzer.python.{clave}'
        mensajes = MENSAJES_ANALIZADOR.get(self.idioma) or {}
        texto = mensajes.get(completo)
        if texto is None:
            respaldo = MENSAJES_ANALIZADOR.get('es') or {}
            texto = respaldo.get(completo, completo)
        return _aplicar_placeholders(texto, params)

    def _traducir_dia(self, dia):
        try:
            indice = DIAS_SEMANA.index(dia)
        except ValueError:
            return dia
        return self._texto(CLAVES_DIAS_SEMANA[indice])

    def _traducir_estado(self, estado):
        clave = ESTADOS_MENSAJE.get(estado)
        return self._texto(clave) if clave else estado

    def _parsear_json(self, contenido):
        try:
            return json.loads(contenido)
        except json.JSONDecodeError as error:
            raise ErrorAnalizador(
                self._texto('errors.invalidJson', reason=error.msg),
            ) from error

    def cargar_datos(self, archivo, tipo='csv'):
        """Carga y limpia los datos desde CSV o JSON

        Args:
            archivo: Archivo o contenido a procesar
            tipo: 'csv' o 'json' - tipo de archivo

        Returns:
            DataFrame de pandas con los datos procesados
        """
        try:
            if tipo == 'json':
                return self._cargar_desde_json(archivo)
            else:
                return self._cargar_desde_csv(archivo)
        except ErrorAnalizador:
            raise
        except Exception as error:
            raise ErrorAnalizador(
                self._texto('errors.readFailed', reason=str(error)),
            ) from error

    def _cargar_desde_json(self, archivo):
        """Carga datos desde un archivo JSON de métricas exportado

        Args:
            archivo: Archivo JSON o contenido JSON como string

        Returns:
            DataFrame de pandas
        """
        # Si es un string, parsearlo como JSON
        if isinstance(archivo, str):
            datos = self._parsear_json(archivo)
        # Si es un archivo, leerlo
        elif hasattr(archivo, 'read'):
            contenido = archivo.read()
            if isinstance(contenido, bytes):
                contenido = contenido.decode('utf-8')
            datos = self._parsear_json(contenido)
        else:
            datos = archivo

        # Validar estructura del JSON
        if 'metrics' not in datos:
            raise ErrorAnalizador(self._texto('errors.missingMetrics'))

        metricas = datos['metrics']

        # El JSON exportado tiene el formato:
        # {
        #   "timestamps": [...],
        #   "density": [...],
        #   "throughput": [...],
        #   "netGeneration": [...],
        #   "speed": [...],
        #   "entropy": [...]
        # }
        # Necesitamos transponer esto a formato de filas

        # Validar que todas las claves necesarias existen
        claves_requeridas = ['timestamps', 'density', 'throughput', 'netGeneration', 'speed', 'entropy']
        for clave in claves_requeridas:
            if clave not in metricas:
                raise ErrorAnalizador(self._texto('errors.missingKey', key=clave))

        # Crear DataFrame desde las listas
        df = pd.DataFrame({
            'Marca_Tiempo': metricas['timestamps'],
            'Densidad': metricas['density'],
            'Flujo': metricas['throughput'],
            'Generacion': metricas['netGeneration'],
            'Velocidad': metricas['speed'],
            'Entropia': metricas['entropy']
        })

        # Filtrar filas que no son datos válidos
        df = df[df['Marca_Tiempo'].notna()]

        # Convertir columnas numéricas
        df['Densidad'] = pd.to_numeric(df['Densidad'], errors='coerce')
        df['Flujo'] = pd.to_numeric(df['Flujo'], errors='coerce')
        df['Generacion'] = pd.to_numeric(df['Generacion'], errors='coerce')
        df['Velocidad'] = pd.to_numeric(df['Velocidad'], errors='coerce')
        df['Entropia'] = pd.to_numeric(df['Entropia'], errors='coerce')

        # Eliminar filas con NaN después de conversión
        df = df.dropna()

        # Resetear índice
        df = df.reset_index(drop=True)

        # Convertir tiempo a segundos desde inicio
        try:
            df['Tiempo_seg'] = pd.to_timedelta(df['Marca_Tiempo']).dt.total_seconds()
        except:
            def tiempo_a_segundos(tiempo_str):
                partes = str(tiempo_str).split(':')
                if len(partes) == 3:
                    return int(partes[0]) * 3600 + int(partes[1]) * 60 + int(partes[2])
                return 0

            df['Tiempo_seg'] = df['Marca_Tiempo'].apply(tiempo_a_segundos)

        # Calcular día de la semana correctamente
        df = self._calcular_dias_semana(df)

        # Calcular tiempo en minutos
        df['Minuto'] = df['Tiempo_Acumulado_seg'] / 60

        return df

    def _cargar_desde_csv(self, archivo):
        """Carga datos desde un archivo CSV

        Args:
            archivo: Archivo CSV

        Returns:
            DataFrame de pandas
        """
        # Leer saltando las filas de metadata
        df = pd.read_csv(archivo, skiprows=6)

        # Renombrar columnas para facilitar el trabajo
        df.columns = ['Marca_Tiempo', 'Densidad', 'Flujo',
                      'Generacion', 'Velocidad', 'Entropia']

        # Filtrar filas que no son datos
        df = df[df['Marca_Tiempo'].notna()]
        df = df[~df['Marca_Tiempo'].astype(str).str.contains('ESTADISTICAS|Metrica|Promedio|Minimo|Maximo',
                                                               case=False, na=False)]

        # Eliminar filas donde las columnas numéricas no son números
        df = df[pd.to_numeric(df['Densidad'], errors='coerce').notna()]

        # Resetear índice
        df = df.reset_index(drop=True)

        # Convertir columnas numéricas
        df['Densidad'] = pd.to_numeric(df['Densidad'], errors='coerce')
        df['Flujo'] = pd.to_numeric(df['Flujo'], errors='coerce')
        df['Generacion'] = pd.to_numeric(df['Generacion'], errors='coerce')
        df['Velocidad'] = pd.to_numeric(df['Velocidad'], errors='coerce')
        df['Entropia'] = pd.to_numeric(df['Entropia'], errors='coerce')

        # Eliminar filas con NaN después de conversión
        df = df.dropna()

        # Convertir tiempo a segundos desde inicio
        try:
            df['Tiempo_seg'] = pd.to_timedelta(df['Marca_Tiempo']).dt.total_seconds()
        except:
            def tiempo_a_segundos(tiempo_str):
                partes = tiempo_str.split(':')
                return int(partes[0]) * 3600 + int(partes[1]) * 60 + int(partes[2])

            df['Tiempo_seg'] = df['Marca_Tiempo'].apply(tiempo_a_segundos)

        # Calcular día de la semana correctamente
        df = self._calcular_dias_semana(df)

        # Calcular tiempo en minutos
        df['Minuto'] = df['Tiempo_Acumulado_seg'] / 60

        return df

    def _calcular_dias_semana(self, df):
        """Calcula el día de la semana detectando cambios de día correctamente"""
        dias_semana = DIAS_SEMANA

        # Detectar cambios de día
        df['Cambio_Dia'] = 0

        for i in range(1, len(df)):
            if df.loc[i, 'Tiempo_seg'] < df.loc[i-1, 'Tiempo_seg']:
                df.loc[i, 'Cambio_Dia'] = 1

        # Calcular el número de día acumulado
        df['Dia_Numero'] = df['Cambio_Dia'].cumsum() + 1

        # Calcular el día de la semana
        df['Dia_Semana_Num'] = (df['Dia_Numero'] - 1) % 7
        df['Dia_Semana'] = df['Dia_Semana_Num'].apply(lambda x: dias_semana[x])

        # Calcular tiempo acumulado en segundos
        df['Tiempo_Acumulado_seg'] = 0.0
        tiempo_acum = 0.0
        dia_actual = 1

        for i in range(len(df)):
            if df.loc[i, 'Dia_Numero'] > dia_actual:
                dia_actual = df.loc[i, 'Dia_Numero']

            tiempo_acum = (df.loc[i, 'Dia_Numero'] - 1) * 86400 + df.loc[i, 'Tiempo_seg']
            df.loc[i, 'Tiempo_Acumulado_seg'] = tiempo_acum

        # Crear fecha/hora real
        fecha_inicio = datetime(2024, 1, 1, 7, 0, 10)
        df['Fecha_Hora'] = df['Tiempo_Acumulado_seg'].apply(
            lambda x: fecha_inicio + timedelta(seconds=x)
        )

        # Hora del día
        df['Hora_Dia'] = df['Tiempo_seg'] / 3600

        return df

    def clasificar_estado_trafico(self, densidad, flujo, velocidad):
        """Clasifica el estado del tráfico según los criterios del sistema FLUVI"""
        # COLAPSO CRÍTICO
        if densidad > 80 and velocidad < 15:
            return '🔴 Colapso', '🔴', '#dc3545'

        # ÓPTIMO
        elif flujo >= 2.5 and 25 <= densidad <= 60 and velocidad >= 50:
            return '🟢 Óptimo', '🟢', '#198754'

        # CONGESTIONADO
        elif densidad > 65 and velocidad < 35:
            return '🟠 Congestionado', '🟠', '#fd7e14'

        # SUB-UTILIZADO
        elif densidad < 25 and flujo < 1.5:
            return '🔵 Sub-utilizado', '🔵', '#0d6efd'

        # MODERADO
        else:
            return '🟡 Moderado', '🟡', '#ffc107'

    def analisis_estadistico_basico(self):
        """Genera estadísticas descriptivas completas"""
        metricas = ['Densidad', 'Flujo', 'Generacion', 'Velocidad', 'Entropia']
        stats_df = self.df[metricas].describe()
        self.resultados['estadisticas'] = stats_df
        return stats_df

    def analisis_por_dia(self):
        """Analiza las métricas agrupadas por día de la semana"""
        stats_por_dia = self.df.groupby('Dia_Semana').agg({
            'Densidad': ['mean', 'std', 'min', 'max', 'count'],
            'Flujo': ['mean', 'std', 'min', 'max'],
            'Velocidad': ['mean', 'std'],
            'Entropia': ['mean', 'std']
        }).round(3)

        conteo_dias = self.df['Dia_Semana'].value_counts()

        stats_por_dia_num = self.df.groupby('Dia_Numero').agg({
            'Dia_Semana': 'first',
            'Densidad': ['mean', 'count'],
            'Flujo': 'mean',
            'Velocidad': 'mean',
            'Entropia': 'mean'
        }).round(3)

        self.resultados['analisis_dias'] = {
            'stats_dia_semana': stats_por_dia,
            'stats_dia_numero': stats_por_dia_num,
            'conteo_dias': conteo_dias,
            'total_dias': self.df['Dia_Numero'].max()
        }

        return stats_por_dia

    def analisis_correlaciones(self):
        """Analiza correlaciones entre variables"""
        metricas = ['Densidad', 'Flujo', 'Velocidad', 'Entropia']
        corr_matrix = self.df[metricas].corr()
        self.resultados['correlaciones'] = corr_matrix
        return corr_matrix

    def analisis_capacidad(self):
        """Identifica capacidad y densidad crítica"""
        idx_max = self.df['Flujo'].idxmax()
        capacidad = self.df.loc[idx_max, 'Flujo']
        densidad_critica = self.df.loc[idx_max, 'Densidad']
        velocidad_critica = self.df.loc[idx_max, 'Velocidad']
        tiempo_critico = self.df.loc[idx_max, 'Marca_Tiempo']
        dia_critico = self.df.loc[idx_max, 'Dia_Semana']
        dia_numero_critico = self.df.loc[idx_max, 'Dia_Numero']
        fecha_critica = self.df.loc[idx_max, 'Fecha_Hora']

        max_densidad = self.df['Densidad'].max()
        bins = [0, 0.5, 1.0, 1.5, 2.0, 3.0, max_densidad + 0.1]
        labels = ['Muy Baja', 'Baja', 'Media', 'Alta', 'Muy Alta', 'Crítica']
        self.df['Rango_Densidad'] = pd.cut(self.df['Densidad'], bins=bins, labels=labels)

        flujo_por_rango = self.df.groupby('Rango_Densidad', observed=True)['Flujo'].agg(['mean', 'count'])

        self.resultados['capacidad'] = {
            'capacidad_maxima': capacidad,
            'densidad_critica': densidad_critica,
            'velocidad_critica': velocidad_critica,
            'tiempo_critico': tiempo_critico,
            'dia_critico': dia_critico,
            'dia_numero_critico': int(dia_numero_critico),
            'fecha_critica': str(fecha_critica)
        }

        return self.resultados['capacidad']

    def detectar_eventos_criticos(self):
        """Detecta eventos anómalos o críticos"""
        umbral_gen = self.df['Generacion'].quantile(0.95)
        eventos_generacion = self.df[self.df['Generacion'] > umbral_gen]

        velocidad_baja = self.df[self.df['Velocidad'] < 85]

        umbral_entropia = self.df['Entropia'].quantile(0.90)
        alta_entropia = self.df[self.df['Entropia'] > umbral_entropia]

        peaks, properties = signal.find_peaks(self.df['Densidad'],
                                             height=2.0,
                                             distance=30)

        self.resultados['eventos_criticos'] = {
            'alta_generacion': len(eventos_generacion),
            'baja_velocidad': len(velocidad_baja),
            'alta_entropia': len(alta_entropia),
            'picos_densidad': len(peaks)
        }

        return self.resultados['eventos_criticos']

    def clustering_estados(self):
        """Identifica estados de tráfico mediante los criterios FLUVI"""
        clasificacion = self.df.apply(
            lambda row: self.clasificar_estado_trafico(
                row['Densidad'],
                row['Flujo'],
                row['Velocidad']
            ),
            axis=1
        )

        self.df['Estado_Nombre'] = clasificacion.apply(lambda x: x[0])
        self.df['Estado_Emoji'] = clasificacion.apply(lambda x: x[1])
        self.df['Estado_Color'] = clasificacion.apply(lambda x: x[2])

        distribucion = self.df['Estado_Nombre'].value_counts()
        porcentajes = self.df['Estado_Nombre'].value_counts(normalize=True) * 100

        stats_estados = self.df.groupby('Estado_Nombre').agg({
            'Densidad': 'mean',
            'Flujo': 'mean',
            'Velocidad': 'mean',
            'Entropia': 'mean'
        }).round(2)

        self.resultados['clustering'] = {
            'distribucion': distribucion,
            'porcentajes': porcentajes,
            'estadisticas': stats_estados
        }

        return stats_estados

    def analisis_temporal(self):
        """Analiza evolución temporal y tendencias"""
        self.df['Minuto_Redondeado'] = self.df['Minuto'].round()
        temporal = self.df.groupby('Minuto_Redondeado').agg({
            'Densidad': 'mean',
            'Flujo': 'mean',
            'Velocidad': 'mean',
            'Entropia': 'mean'
        })

        slope_densidad, _, _, _, _ = stats.linregress(self.df['Tiempo_Acumulado_seg'], self.df['Densidad'])

        self.resultados['temporal'] = temporal
        return temporal

    def fig_to_base64(self, fig):
        """Convierte una figura de matplotlib a base64 para mostrar en web"""
        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=300, bbox_inches='tight')
        buf.seek(0)
        img_base64 = base64.b64encode(buf.read()).decode('utf-8')
        buf.close()
        plt.close(fig)
        return f"data:image/png;base64,{img_base64}"

    def generar_visualizaciones(self):
        """Genera las 3 visualizaciones y las retorna como base64"""
        plt.style.use('default')

        # Configurar paleta de colores (con o sin seaborn)
        if SEABORN_AVAILABLE:
            sns.set_palette("husl")

        texto = self._texto
        densidad = texto('plots.common.density')
        densidad_pct = texto('plots.common.densityPercent')
        flujo = texto('plots.common.flow')
        flujo_veh_s = texto('plots.common.flowPerSecond')
        entropia_bits = texto('plots.common.entropyBits')
        velocidad_pct = texto('plots.common.speedPercent')
        frecuencia = texto('plots.common.frequency')
        tiempo_minutos = texto('plots.common.timeMinutes')
        hora_dia = texto('plots.common.hourOfDay')
        dia_semana = texto('plots.common.weekday')

        imagenes = {}

        # IMAGEN 1: analisis_temporal.png
        fig1, axes = plt.subplots(2, 2, figsize=(18, 10))
        fig1.suptitle(texto('plots.temporal.suptitle'), fontsize=16, fontweight='bold')

        axes[0,0].plot(self.df['Minuto'], self.df['Densidad'], linewidth=0.5, alpha=0.7)
        axes[0,0].set_title(texto('plots.temporal.densityTitle'), fontsize=12, fontweight='bold')
        axes[0,0].set_ylabel(densidad_pct, fontsize=11)
        axes[0,0].grid(True, alpha=0.3)

        axes[0,1].plot(self.df['Minuto'], self.df['Flujo'], linewidth=0.5, alpha=0.7, color='orange')
        axes[0,1].set_title(texto('plots.temporal.flowTitle'), fontsize=12, fontweight='bold')
        axes[0,1].set_ylabel(flujo_veh_s, fontsize=11)
        axes[0,1].grid(True, alpha=0.3)

        axes[1,0].plot(self.df['Minuto'], self.df['Velocidad'], linewidth=0.5, alpha=0.7, color='green')
        axes[1,0].set_title(texto('plots.temporal.speedTitle'), fontsize=12, fontweight='bold')
        axes[1,0].set_ylabel(velocidad_pct, fontsize=11)
        axes[1,0].set_xlabel(tiempo_minutos, fontsize=11)
        axes[1,0].grid(True, alpha=0.3)

        if 'Estado_Nombre' in self.df.columns:
            orden_estados = ['🔵 Sub-utilizado', '🟡 Moderado', '🟢 Óptimo',
                           '🟠 Congestionado', '🔴 Colapso']

            colores_estados = {
                '🔵 Sub-utilizado': '#0d6efd',
                '🟡 Moderado': '#ffc107',
                '🟢 Óptimo': '#198754',
                '🟠 Congestionado': '#fd7e14',
                '🔴 Colapso': '#dc3545'
            }

            for estado in orden_estados:
                if estado in self.df['Estado_Nombre'].values:
                    mask = self.df['Estado_Nombre'] == estado
                    axes[1,1].scatter(self.df.loc[mask, 'Minuto'],
                                    self.df.loc[mask, 'Densidad'],
                                    label=self._traducir_estado(estado),
                                    s=3,
                                    alpha=0.6,
                                    color=colores_estados[estado])

            axes[1,1].set_title(texto('plots.temporal.statesTitle'), fontsize=12, fontweight='bold')
            axes[1,1].set_xlabel(tiempo_minutos, fontsize=11)
            axes[1,1].set_ylabel(densidad_pct, fontsize=11)
            axes[1,1].legend(loc='best', fontsize=9, framealpha=0.9)
            axes[1,1].grid(True, alpha=0.3)
        else:
            axes[1,1].axis('off')

        plt.tight_layout()
        imagenes['temporal'] = self.fig_to_base64(fig1)

        # IMAGEN 2: diagramas_fundamentales.png (CON MAPAS DE CALOR)
        fig2, axes = plt.subplots(1, 3, figsize=(24, 6))
        fig2.suptitle(texto('plots.fundamental.suptitle'), fontsize=16, fontweight='bold')

        # Subplot 1: Entropía vs Densidad
        scatter = axes[0].scatter(self.df['Densidad'], self.df['Entropia'],
                             c=self.df['Flujo'], cmap='plasma',
                             s=5, alpha=0.6)
        axes[0].set_xlabel(densidad_pct, fontsize=12)
        axes[0].set_ylabel(entropia_bits, fontsize=12)
        axes[0].set_title(texto('plots.fundamental.entropyTitle'), fontsize=13, fontweight='bold')
        plt.colorbar(scatter, ax=axes[0], label=flujo_veh_s)
        axes[0].grid(True, alpha=0.3)

        # Preparar datos para los mapas de calor
        # Redondear hora del día a enteros
        self.df['Hora_Redondeada'] = self.df['Hora_Dia'].round().astype(int)

        # Crear tabla pivote para el heatmap
        heatmap_data = self.df.pivot_table(
            values='Densidad',
            index='Dia_Semana',
            columns='Hora_Redondeada',
            aggfunc='mean'
        )

        # Reordenar filas según el orden de días de la semana
        heatmap_data = heatmap_data.reindex([dia for dia in DIAS_SEMANA if dia in heatmap_data.index])

        # Traducir solo las etiquetas visibles; los datos conservan sus claves internas.
        etiquetas_dias = {dia: self._traducir_dia(dia) for dia in heatmap_data.index}
        heatmap_data = heatmap_data.rename(index=etiquetas_dias)

        # Subplot 2: Mapa de Calor - Densidad con escala fija (0-100%)
        if SEABORN_AVAILABLE:
            sns.heatmap(heatmap_data,
                       cmap='YlOrRd',
                       cbar_kws={'label': densidad_pct},
                       ax=axes[1],
                       linewidths=0.5,
                       linecolor='white',
                       vmin=0,
                       vmax=100)
        else:
            # Alternativa sin seaborn usando matplotlib puro
            im = axes[1].imshow(heatmap_data, cmap='YlOrRd', aspect='auto', vmin=0, vmax=100)
            axes[1].set_xticks(range(len(heatmap_data.columns)))
            axes[1].set_xticklabels(heatmap_data.columns)
            axes[1].set_yticks(range(len(heatmap_data.index)))
            axes[1].set_yticklabels(heatmap_data.index)
            plt.colorbar(im, ax=axes[1], label=densidad_pct)

        axes[1].set_title(texto('plots.fundamental.fixedHeatmapTitle'), fontsize=13, fontweight='bold')
        axes[1].set_xlabel(hora_dia, fontsize=12)
        axes[1].set_ylabel(dia_semana, fontsize=12)
        axes[1].set_yticklabels(axes[1].get_yticklabels(), rotation=0)

        # Subplot 3: Mapa de Calor - Densidad con escala dinámica (0-máximo)
        # Calcular el máximo valor de densidad en los datos
        max_densidad = heatmap_data.max().max()

        if SEABORN_AVAILABLE:
            sns.heatmap(heatmap_data,
                       cmap='YlOrRd',
                       cbar_kws={'label': densidad_pct},
                       ax=axes[2],
                       linewidths=0.5,
                       linecolor='white',
                       vmin=0,
                       vmax=max_densidad)
        else:
            # Alternativa sin seaborn usando matplotlib puro
            im2 = axes[2].imshow(heatmap_data, cmap='YlOrRd', aspect='auto', vmin=0, vmax=max_densidad)
            axes[2].set_xticks(range(len(heatmap_data.columns)))
            axes[2].set_xticklabels(heatmap_data.columns)
            axes[2].set_yticks(range(len(heatmap_data.index)))
            axes[2].set_yticklabels(heatmap_data.index)
            plt.colorbar(im2, ax=axes[2], label=densidad_pct)

        axes[2].set_title(
            texto('plots.fundamental.dynamicHeatmapTitle', max=f'{max_densidad:.1f}'),
            fontsize=13,
            fontweight='bold',
        )
        axes[2].set_xlabel(hora_dia, fontsize=12)
        axes[2].set_ylabel(dia_semana, fontsize=12)
        axes[2].set_yticklabels(axes[2].get_yticklabels(), rotation=0)

        plt.tight_layout()
        imagenes['fundamentales'] = self.fig_to_base64(fig2)

        # IMAGEN 3: distribuciones_correlaciones.png
        fig3, axes = plt.subplots(2, 2, figsize=(14, 10))
        fig3.suptitle(texto('plots.distributions.suptitle'), fontsize=16, fontweight='bold')

        axes[0,0].hist(self.df['Densidad'], bins=50, edgecolor='black', alpha=0.7, color='steelblue')
        axes[0,0].set_title(texto('plots.distributions.densityTitle'), fontsize=12, fontweight='bold')
        axes[0,0].set_xlabel(densidad_pct, fontsize=11)
        axes[0,0].set_ylabel(frecuencia, fontsize=11)
        axes[0,0].grid(True, alpha=0.3, axis='y')

        axes[0,1].hist(self.df['Flujo'], bins=50, edgecolor='black', alpha=0.7, color='orange')
        axes[0,1].set_title(texto('plots.distributions.flowTitle'), fontsize=12, fontweight='bold')
        axes[0,1].set_xlabel(flujo_veh_s, fontsize=11)
        axes[0,1].set_ylabel(frecuencia, fontsize=11)
        axes[0,1].grid(True, alpha=0.3, axis='y')

        bp1 = axes[1,0].boxplot([self.df['Densidad']], patch_artist=True)
        bp1['boxes'][0].set_facecolor('steelblue')
        bp1['boxes'][0].set_alpha(0.7)
        axes[1,0].set_xticklabels([densidad])
        axes[1,0].set_title(texto('plots.distributions.densityBoxTitle'), fontsize=12, fontweight='bold')
        axes[1,0].set_ylabel(densidad_pct, fontsize=11)
        axes[1,0].grid(True, alpha=0.3, axis='y')

        bp2 = axes[1,1].boxplot([self.df['Flujo']], patch_artist=True)
        bp2['boxes'][0].set_facecolor('orange')
        bp2['boxes'][0].set_alpha(0.7)
        axes[1,1].set_xticklabels([flujo])
        axes[1,1].set_title(texto('plots.distributions.flowBoxTitle'), fontsize=12, fontweight='bold')
        axes[1,1].set_ylabel(flujo_veh_s, fontsize=11)
        axes[1,1].grid(True, alpha=0.3, axis='y')

        plt.tight_layout()
        imagenes['distribuciones'] = self.fig_to_base64(fig3)

        return imagenes

    def ejecutar_analisis_completo(self):
        """Ejecuta todos los análisis en secuencia"""
        self.analisis_estadistico_basico()
        self.analisis_por_dia()
        self.analisis_correlaciones()
        self.analisis_capacidad()
        self.detectar_eventos_criticos()
        self.clustering_estados()
        self.analisis_temporal()
        imagenes = self.generar_visualizaciones()
        self.resultados['imagenes'] = imagenes
        return self.resultados


# Funciones para usar desde JavaScript con Pyodide
def analizar_csv_web(contenido_csv, idioma='es'):
    """Función wrapper para llamar desde JavaScript con CSV"""
    import io
    archivo = io.StringIO(contenido_csv)
    analizador = AnalizadorTraficoFLUVI(archivo, tipo='csv', idioma=idioma)
    resultados = analizador.ejecutar_analisis_completo()
    return resultados['imagenes']

def analizar_json_web(contenido_json, idioma='es'):
    """Función wrapper para llamar desde JavaScript con JSON"""
    analizador = AnalizadorTraficoFLUVI(contenido_json, tipo='json', idioma=idioma)
    resultados = analizador.ejecutar_analisis_completo()
    return resultados['imagenes']

def analizar_archivo_web(contenido, tipo='csv', idioma='es'):
    """Función wrapper genérica para llamar desde JavaScript

    Args:
        contenido: Contenido del archivo (CSV como string o JSON como string)
        tipo: 'csv' o 'json'
        idioma: 'es' o 'en'; al omitirlo se conserva la salida en español

    Returns:
        Diccionario con las imágenes generadas en base64
    """
    if tipo == 'json':
        return analizar_json_web(contenido, idioma=idioma)
    else:
        return analizar_csv_web(contenido, idioma=idioma)
