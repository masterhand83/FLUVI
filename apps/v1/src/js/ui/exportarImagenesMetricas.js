// Exportación independiente del tamaño, visibilidad y tema del panel lateral.
(() => {
    const WIDTH = 1600;
    const chartDefinitions = [
        ['densidad', 'Densidad (%)', () => densityChartInstance, 'density'],
        ['flujo_vehicular', 'Flujo (veh/s)', () => throughputChartInstance, 'throughput'],
        ['velocidad', 'Velocidad (% movimiento)', () => speedChartInstance, 'speed'],
        ['tasa_de_cambio', 'Cambio neto (veh/s)', () => netGenerationChartInstance, 'netGeneration'],
        ['entropia', 'Entropía (bits)', () => entropyChartInstance, 'entropy']
    ];

    function reportCanvas(height) {
        const canvas = document.createElement('canvas');
        canvas.width = WIDTH;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, WIDTH, height);
        ctx.fillStyle = '#172033';
        return canvas;
    }

    // Conservar callbacks de Chart.js sin compartir objetos mutables con la UI.
    function clone(value) {
        if (Array.isArray(value)) return value.map(clone);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
        }
        return value;
    }

    function chartImage(source, name, unit, metric) {
        if (!source) throw new Error('Las gráficas todavía no están disponibles');
        const plot = document.createElement('canvas');
        plot.width = WIDTH - 96;
        plot.height = 650;
        const options = clone(source.config.options);
        options.responsive = false;
        options.animation = false;
        options.devicePixelRatio = 1;
        options.scales.x.title = { ...options.scales.x.title, display: true, text: 'Tiempo virtual' };
        options.scales.y.title = { ...options.scales.y.title, display: true, text: unit };
        if (name === 'tasa_de_cambio') delete options.scales.y.min;
        for (const axis of Object.values(options.scales || {})) {
            axis.ticks = { ...axis.ticks, color: '#334155', font: { ...axis.ticks?.font, size: 24 } };
            axis.grid = { ...axis.grid, color: '#e2e8f0' };
            axis.title = { ...axis.title, color: '#334155', font: { ...axis.title?.font, size: 28 } };
        }
        if (options.plugins?.legend?.labels) options.plugins.legend.labels.color = '#334155';
        // Usar el mismo historial completo que CSV sin modificar las gráficas en vivo.
        const data = clone(source.data);
        data.labels = [...completeMetricsHistory.timestamps];
        data.datasets[0].data = [...completeMetricsHistory[metric]];
        const chart = new Chart(plot, {
            type: source.config.type,
            data,
            options
        });
        try {
            chart.update('none');
            const image = reportCanvas(746);
            image.getContext('2d').drawImage(plot, 48, 48);
            return image;
        } finally {
            chart.destroy();
        }
    }

    function summaryImage() {
        const panel = document.getElementById('statusPanel');
        const text = element => element?.textContent.replace(/\s+/g, ' ').trim() || '';
        const measure = document.createElement('canvas').getContext('2d');
        measure.font = '26px sans-serif';
        function wrap(paragraph, width) {
            const lines = [];
            let line = '';
            for (const word of paragraph.split(' ')) {
                const next = line ? `${line} ${word}` : word;
                if (line && measure.measureText(next).width > width) {
                    lines.push(line);
                    line = word;
                } else line = next;
            }
            lines.push(line);
            return lines;
        }
        const description = wrap(text(panel.querySelector('.status-description')), WIDTH - 192);
        const rows = [...panel.querySelectorAll('.metric-item')].map(item => [
            text(item.querySelector('.metric-label')).replace(/:$/, ''),
            text(item.querySelector('.metric-value')),
            text(item.querySelector('.metric-desc')).replace(/^→\s*/, '')
        ]);
        rows.push(['Entropía de Shannon', `${metricsHistory.entropy.at(-1)} bits`, 'Diversidad de transiciones del autómata']);
        const observations = [...panel.querySelectorAll('.observation-item')]
            .map(item => wrap(text(item).replace(/^•\s*/, ''), WIDTH - 216));
        if (!observations.length) observations.push(['Sin observaciones adicionales.']);
        const notes = [
            `Gráficas: historial completo (${completeMetricsHistory.timestamps.length} mediciones desde la última limpieza o reinicio).`,
            'Resumen: última medición disponible, no un promedio histórico.',
            `Calles incluidas en métricas: ${window.calles.filter((_, index) => callesIncluidasEnMetricas === null || callesIncluidasEnMetricas.has(index)).length}/${window.calles.length}.`,
            'Mapa de calor: estado actual de todas las calles. La escala verde–rojo representa menor–mayor congestión.'
        ].flatMap(note => wrap(note, WIDTH - 160));
        const bandHeight = 110 + description.length * 38;
        const tableTop = 48 + bandHeight + 48;
        const observationsTop = tableTop + 64 + rows.length * 76 + 60;
        const notesTop = observationsTop + 64 + observations.reduce((sum, lines) => sum + lines.length * 38 + 20, 0) + 32;
        const image = reportCanvas(notesTop + 80 + notes.length * 38);
        const ctx = image.getContext('2d');
        ctx.fillStyle = '#edf2f7';
        ctx.fillRect(48, 48, WIDTH - 96, bandHeight);
        ctx.fillStyle = '#244663';
        ctx.fillRect(48, 48, 8, bandHeight);
        ctx.font = 'bold 32px sans-serif';
        ctx.fillText(text(panel.querySelector('.status-title')), 80, 100);
        ctx.fillStyle = '#334155';
        ctx.font = '26px sans-serif';
        description.forEach((line, index) => ctx.fillText(line, 80, 148 + index * 38));

        // Tabla con columnas alineadas y sombreado discreto, apta para impresión.
        ctx.fillStyle = '#244663';
        ctx.fillRect(48, tableTop, WIDTH - 96, 64);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 26px sans-serif';
        ['Indicador', 'Valor', 'Interpretación'].forEach((label, index) => ctx.fillText(label, [80, 510, 800][index], tableTop + 42));
        rows.forEach((row, index) => {
            const y = tableTop + 64 + index * 76;
            ctx.fillStyle = index % 2 === 0 ? '#f5f7fa' : '#ffffff';
            ctx.fillRect(48, y, WIDTH - 96, 76);
            ctx.fillStyle = '#172033';
            row.forEach((value, column) => {
                ctx.font = column === 1 ? 'bold 28px sans-serif' : '26px sans-serif';
                ctx.fillText(value, [80, 510, 800][column], y + 48);
            });
            ctx.strokeStyle = '#dce3eb';
            ctx.beginPath();
            ctx.moveTo(48, y + 76);
            ctx.lineTo(WIDTH - 48, y + 76);
            ctx.stroke();
        });

        ctx.fillStyle = '#244663';
        ctx.font = 'bold 28px sans-serif';
        ctx.fillText('Observaciones', 80, observationsTop + 32);
        ctx.font = '26px sans-serif';
        ctx.fillStyle = '#334155';
        let y = observationsTop + 80;
        observations.forEach(lines => {
            ctx.fillText('•', 80, y);
            lines.forEach(line => { ctx.fillText(line, 116, y); y += 38; });
            y += 20;
        });
        ctx.strokeStyle = '#dce3eb';
        ctx.beginPath();
        ctx.moveTo(48, notesTop);
        ctx.lineTo(WIDTH - 48, notesTop);
        ctx.stroke();
        ctx.fillStyle = '#475569';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText('Alcance de los datos', 80, notesTop + 42);
        ctx.font = '24px sans-serif';
        notes.forEach((line, index) => ctx.fillText(line, 80, notesTop + 82 + index * 38));
        return image;
    }

    function png(canvas) {
        return new Promise((resolve, reject) => canvas.toBlob(
            blob => blob ? resolve(blob) : reject(new Error('No se pudo generar una imagen PNG')),
            'image/png'
        ));
    }

    async function exportImages(button) {
        if (button.disabled) return;
        if (!completeMetricsHistory.timestamps.length) {
            mostrarAdvertencia('Sin métricas', 'Ejecuta la simulación antes de exportar imágenes.');
            return;
        }
        const label = button.textContent;
        button.disabled = true;
        button.textContent = 'Exportando imágenes…';
        try {
            if (!window.JSZip || !window.heatmapModal) throw new Error('No se cargaron los módulos de exportación');
            // Capturar todo antes del primer await: la simulación puede seguir corriendo.
            const images = chartDefinitions.map(([name, unit, source, metric]) => [name, chartImage(source(), name, unit, metric)]);
            images.push(['resumen', summaryImage()]);
            const map = window.heatmapModal.render({ canvas: document.createElement('canvas'), maxWidth: WIDTH - 96, maxHeight: 1100 });
            const heatmap = reportCanvas(map.height + 170);
            const ctx = heatmap.getContext('2d');
            ctx.drawImage(map, (WIDTH - map.width) / 2, 48);
            const gradient = ctx.createLinearGradient(48, 0, WIDTH - 48, 0);
            [0, 0.33, 0.66, 1].forEach(stop => gradient.addColorStop(stop, window.heatmapModal.getColorForDensity(stop)));
            ctx.fillStyle = gradient;
            ctx.fillRect(48, map.height + 78, WIDTH - 96, 20);
            ctx.fillStyle = '#172033';
            ctx.font = '26px sans-serif';
            ctx.fillText('Menor congestión', 48, map.height + 135);
            ctx.textAlign = 'right';
            ctx.fillText('Mayor congestión', WIDTH - 48, map.height + 135);
            images.push(['mapa_de_calor', heatmap]);
            const zip = new JSZip();
            await Promise.all(images.map(async ([name, image]) => {
                zip.file(`${name}.png`, await (await png(image)).arrayBuffer());
            }));
            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `metricas_imagenes_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            console.error('Error al exportar imágenes de métricas:', error);
            mostrarError('Error de exportación', 'No se pudieron exportar las imágenes. Intenta nuevamente.');
        } finally {
            button.disabled = false;
            button.textContent = label;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const button = document.getElementById('btnExportarImagenes');
        if (button) button.addEventListener('click', () => exportImages(button));
    });
})();
