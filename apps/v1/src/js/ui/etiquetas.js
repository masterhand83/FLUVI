// Attached object names share visibility, screen-space sizing and halo styling.
const fondoEtiqueta = { color: 0x111827, alpha: 0.12, paddingX: 4, paddingY: 2, radius: 3 };

function actualizarFondoEtiqueta(container) {
    const bounds = container.labelText.getLocalBounds();
    const { color, alpha, paddingX, paddingY, radius } = fondoEtiqueta;
    container.labelBackground.clear().beginFill(color, alpha)
        .drawRoundedRect(bounds.x - paddingX, bounds.y - paddingY,
            bounds.width + paddingX * 2, bounds.height + paddingY * 2, radius).endFill();
}

function crearEtiquetaPixi(nombre) {
    const container = new PIXI.Container();
    container.eventMode = 'none';
    container.labelBackground = new PIXI.Graphics();
    container.labelText = new PIXI.Text(nombre, estiloEtiqueta());
    container.labelText.anchor.set(0.5);
    container.labelText.resolution = Math.max(2, window.devicePixelRatio || 1);
    container.addChild(container.labelBackground, container.labelText);
    actualizarFondoEtiqueta(container);
    return container;
}
function etiquetasVisibles(category) {
    return window.labelVisibility === 'both' || window.labelVisibility === category;
}

function estiloEtiqueta() {
    return {
        fontFamily: 'Arial', fontWeight: 'normal',
        fontSize: window.labelFontSize || 14,
        fill: '#222222', stroke: '#FFFFFF', strokeThickness: 2,
        lineJoin: 'round', align: 'center',
    };
}

function anguloEtiqueta(angulo) {
    let radians = -angulo * Math.PI / 180;
    radians = ((radians + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2;
    return radians;
}

function calcularPosicionEnCalle(calle) {
    if (window.roundaboutStreet?.isRoundabout(calle)) {
        const angle = calle.startAngle * Math.PI / 180 + Math.PI;
        const radius = calle.innerRadius + calle.carriles * celda_tamano / 2;
        return { x: calle.x + radius * Math.cos(angle), y: calle.y + radius * Math.sin(angle),
            angulo: -(angle * 180 / Math.PI + 90) };
    }
    if (window.streetBezier?.isBezier(calle)) {
        return window.streetBezier.centerlinePosition(calle, 0.5);
    }
    if (calle.esCurva && calle.vertices?.length >= 2) {
        // Legacy geometry is integrated in equal-length cell steps. The center
        // lane accepts a fractional lane, but cell indexes must remain integers.
        const distanceInCells = calle.tamano / 2;
        const index = Math.floor(distanceInCells);
        const point = obtenerCoordenadasGlobalesCeldaConCurva(calle, (calle.carriles - 1) / 2, index);
        const angle = -point.angulo * Math.PI / 180;
        const delta = (distanceInCells - index - 0.5) * celda_tamano;
        return { x: point.x + Math.cos(angle) * delta, y: point.y + Math.sin(angle) * delta, angulo: point.angulo };
    }
    const angle = -calle.angulo * Math.PI / 180;
    const x = calle.tamano * celda_tamano / 2, y = calle.carriles * celda_tamano / 2;
    return { x: calle.x + x * Math.cos(angle) - y * Math.sin(angle),
        y: calle.y + x * Math.sin(angle) + y * Math.cos(angle), angulo: calle.angulo };
}

function dibujarEtiqueta(nombre, center, rotation = 0) {
    const style = estiloEtiqueta();
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(rotation);
    const zoom = window.escala || 1;
    ctx.scale(1 / zoom, 1 / zoom);
    ctx.font = `${style.fontSize}px ${style.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(nombre);
    const ascent = metrics.actualBoundingBoxAscent;
    const descent = metrics.actualBoundingBoxDescent;
    const { paddingX, paddingY, radius, alpha } = fondoEtiqueta;
    ctx.fillStyle = `rgba(17, 24, 39, ${alpha})`;
    ctx.beginPath();
    ctx.roundRect(-metrics.width / 2 - paddingX - style.strokeThickness / 2,
        -ascent - paddingY - style.strokeThickness / 2,
        metrics.width + paddingX * 2 + style.strokeThickness,
        ascent + descent + paddingY * 2 + style.strokeThickness, radius);
    ctx.fill();
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.strokeThickness;
    ctx.lineJoin = 'round';
    ctx.strokeText(nombre, 0, 0);
    ctx.fillText(nombre, 0, 0);
    ctx.restore();
}

function dibujarEtiquetasCalles() {
    if (!etiquetasVisibles('streets')) return;
    calles.forEach(calle => {
        if (!calle.nombre) return;
        const point = calcularPosicionEnCalle(calle);
        dibujarEtiqueta(calle.nombre, point, anguloEtiqueta(point.angulo));
    });
}

function dibujarEtiquetasEdificios() {
    if (!etiquetasVisibles('buildings')) return;
    (window.edificios || edificios).forEach(edificio => {
        if (!edificio.label || edificio.label === 'CONO') return;
        if (esEdificioPoligonal(edificio) && !edificioPolygonGeometry.validate(edificio.vertices).valid) return;
        const center = esEdificioPoligonal(edificio) ? edificioPolygonGeometry.center(edificio.vertices) : edificio;
        dibujarEtiqueta(edificio.label, center);
    });
}
