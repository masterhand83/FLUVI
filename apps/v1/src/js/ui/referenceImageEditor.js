// A screen-space editing surface over either map renderer. Geometry stays in map units.
class ReferenceImageEditor {
    constructor() {
        this.selected = false;
        this.locked = false;
        this.drag = null;
        this.frame = document.createElement('div');
        this.frame.className = 'reference-image-frame';
        this.frame.setAttribute('aria-label', 'Imagen de referencia seleccionada; arrastra para mover');
        this.frame.innerHTML = '<span class="reference-image-rotate-stem"></span><span class="reference-image-handle reference-image-rotate" data-reference-image-handle="rotate" title="Girar imagen" aria-label="Girar imagen"></span><span class="reference-image-handle reference-image-resize" data-reference-image-handle="resize" title="Cambiar tamaño proporcionalmente" aria-label="Cambiar tamaño proporcionalmente"></span>';
        document.body.appendChild(this.frame);

        this.button = document.getElementById('btnBloquearImagenReferencia');
        this.button?.addEventListener('click', () => {
            this.locked = !this.locked;
            this.button.setAttribute('aria-pressed', String(this.locked));
            this.button.textContent = this.locked ? '🔒 Desbloquear imagen para alinearla' : '🔓 Bloquear imagen para editar el mapa';
            this.sync();
        });
        this.frame.addEventListener('pointerdown', event => this.start(event));
        this.frame.addEventListener('pointermove', event => this.move(event));
        this.frame.addEventListener('pointerup', event => this.end(event));
        this.frame.addEventListener('pointercancel', event => this.end(event));
        // CameraController and the Canvas fallback listen for mouse events on the canvas.
        // The frame is a sibling, so dragging it cannot accidentally pan the map.
        const tick = () => {
            this.sync();
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    select() {
        this.selected = true;
        this.sync();
    }

    view() {
        return document.getElementById('simuladorCanvas');
    }

    metrics() {
        const view = this.view();
        if (!view) return null;
        const rect = view.getBoundingClientRect();
        // Pixi's backing canvas can be devicePixelRatio times its logical size.
        const width = window.USE_PIXI && window.pixiApp?.app?.view === view
            ? window.pixiApp.app.renderer.screen.width : view.width;
        const height = window.USE_PIXI && window.pixiApp?.app?.view === view
            ? window.pixiApp.app.renderer.screen.height : view.height;
        return {
            x: rect.left + (Number(window.offsetX) || 0) * rect.width / width,
            y: rect.top + (Number(window.offsetY) || 0) * rect.height / height,
            scaleX: (Number(window.escala) || 1) * rect.width / width,
            scaleY: (Number(window.escala) || 1) * rect.height / height
        };
    }

    sync() {
        const image = window.referenceImage;
        const m = this.metrics();
        this.frame.style.display = image && this.selected && !this.locked && m ? 'block' : 'none';
        if (!image || !m || this.locked) return;
        this.frame.style.left = `${m.x + image.x * m.scaleX}px`;
        this.frame.style.top = `${m.y + image.y * m.scaleY}px`;
        this.frame.style.width = `${image.width * m.scaleX}px`;
        this.frame.style.height = `${image.height * m.scaleY}px`;
        this.frame.style.transform = `rotate(${image.rotation || 0}deg)`;
    }

    start(event) {
        if (event.button !== 0 || !window.referenceImage || this.locked) return;
        event.preventDefault();
        event.stopPropagation();
        const image = window.referenceImage;
        const m = this.metrics();
        const kind = event.target.dataset.referenceImageHandle || 'move';
        const centerX = m.x + (image.x + image.width / 2) * m.scaleX;
        const centerY = m.y + (image.y + image.height / 2) * m.scaleY;
        this.drag = {
            kind, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
            x: image.x, y: image.y, width: image.width, height: image.height,
            rotation: image.rotation || 0, scaleX: m.scaleX, scaleY: m.scaleY,
            centerX, centerY,
            pointerAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX)
        };
        this.frame.setPointerCapture(event.pointerId);
    }

    move(event) {
        const d = this.drag;
        if (!d || d.pointerId !== event.pointerId || !window.referenceImage) return;
        event.preventDefault();
        const image = window.referenceImage;
        const dx = (event.clientX - d.startX) / d.scaleX;
        const dy = (event.clientY - d.startY) / d.scaleY;
        if (d.kind === 'move') {
            image.x = d.x + dx;
            image.y = d.y + dy;
        } else if (d.kind === 'resize') {
            // Project the pointer delta onto the original diagonal in local axes.
            // The upper-left corner is the fixed anchor, including when rotated.
            const angle = d.rotation * Math.PI / 180;
            const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
            const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
            const factor = Math.max(0.05, 1 + (localX * d.width + localY * d.height) / (d.width ** 2 + d.height ** 2));
            const addedWidth = d.width * (factor - 1);
            const addedHeight = d.height * (factor - 1);
            image.width = d.width * factor;
            image.height = d.height * factor;
            image.x = d.x + ((addedWidth * Math.cos(angle) - addedHeight * Math.sin(angle)) - addedWidth) / 2;
            image.y = d.y + ((addedWidth * Math.sin(angle) + addedHeight * Math.cos(angle)) - addedHeight) / 2;
        } else if (d.kind === 'rotate') {
            image.rotation = d.rotation + (Math.atan2(event.clientY - d.centerY, event.clientX - d.centerX) - d.pointerAngle) * 180 / Math.PI;
        }
        this.sync();
        if (window.USE_PIXI && window.pixiApp?.sceneManager) {
            window.pixiApp.sceneManager.referenceImageRenderer.render();
        } else {
            window.renderizarCanvas?.();
        }
    }

    end(event) {
        if (this.drag?.pointerId !== event.pointerId) return;
        this.drag = null;
        if (this.frame.hasPointerCapture(event.pointerId)) this.frame.releasePointerCapture(event.pointerId);
    }
}

window.referenceImageEditor = new ReferenceImageEditor();
