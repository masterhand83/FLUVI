import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

function setup() {
    class Container {
        children = [];
        addChild(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
        removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; }
        getChildByName(name) { return this.children.find(child => child.name === name); }
        on() {}
        destroy() {}
    }
    class Graphics extends Container {
        circles = [];
        holes = [];
        lines = [];
        beginFill() {}
        endFill() {}
        beginHole() { this.inHole = true; }
        endHole() { this.inHole = false; }
        drawCircle(x, y, r) { (this.inHole ? this.holes : this.circles).push([x, y, r]); }
        drawRect() {}
        lineStyle() {}
        moveTo(x, y) { this.start = [x, y]; }
        lineTo(x, y) { this.lines.push([this.start, [x, y]]); }
    }
    class Sprite extends Container { anchor = { set() {} }; }
    class TilingSprite extends Sprite { tileScale = { set() {} }; }
    const window = { celda_tamano: 5 };
    const layer = new Container();
    const scene = { calleSprites: new Map(), carroSprites: new Map(), conexionGraphics: new Map(),
        getLayer: () => layer };
    const context = { window, console, PIXI: { Container, Graphics, Sprite, TilingSprite },
        CoordinateConverter: { degreesToRadians: value => -value * Math.PI / 180 } };
    for (const file of ['core/roundaboutStreet.js', 'renderer/renderers/CalleRenderer.js',
        'renderer/renderers/CarroRenderer.js', 'renderer/renderers/ConexionRenderer.js']) {
        runInNewContext(readFileSync(new URL(`../src/js/${file}`, import.meta.url), 'utf8'), context);
    }
    const road = window.roundaboutStreet.createStreet({ nombre: 'Rotonda', x: 100, y: 120,
        innerRadius: 20, startAngle: 0, carriles: 2 }, 5);
    const assets = { getTexture: name => ({ name, width: 5, height: 5 }) };
    return { window, scene, road, layer,
        streets: new window.CalleRenderer(scene, assets),
        cars: new window.CarroRenderer(scene, assets),
        links: new window.ConexionRenderer(scene, assets) };
}

describe('roundabout Pixi integration', () => {
    it('draws a hollow, pickable road with lane boundaries and clockwise cues; updates its geometry', () => {
        const { window, scene, road, streets } = setup();
        streets.renderAll([road]);
        const container = scene.calleSprites.get(road);
        const surface = container.children[0];
        expect(surface.circles.some(circle => circle[2] === 30)).toBe(true);
        expect(surface.holes).toEqual([[0, 0, 20]]);
        expect(surface.hitArea.contains(0, 0)).toBe(false);
        expect(surface.hitArea.contains(25, 0)).toBe(true);
        expect(surface.hitArea.contains(31, 0)).toBe(false);
        const cues = container.getChildByName('laneDirectionArrows');
        expect(cues.eventMode).toBe('none');
        expect(cues.lines.length).toBeGreaterThan(0);
        expect(scene.calleSprites.get(road)).toBe(container);
        streets.renderAll([road]);
        expect(scene.calleSprites.get(road)).toBe(container);
        window.calleSeleccionada = road;
        streets.addSelectionBorderRoundabout(container, road);
        expect(container.getChildByName('selectionBorder').circles).toHaveLength(2);
        road.innerRadius = 25;
        streets.renderAll([road]);
        expect(scene.calleSprites.get(road)).not.toBe(container);
        expect(scene.calleSprites.get(road).children[0].holes).toEqual([[0, 0, 25]]);
    });

    // Name placement is now covered through rendered pixels in map-labels.spec.mjs.
    it('places cars and links on exact sectors', () => {
        const { window, scene, road, cars, links } = setup();
        road.arreglo[0][0] = 2;
        cars.updateCell(road, 0, 0);
        const sprite = scene.carroSprites.get('Rotonda_0_0');
        const point = window.roundaboutStreet.coordinates(road, 0, 0);
        expect(sprite.x).toBeCloseTo(point.x);
        expect(sprite.y).toBeCloseTo(point.y);
        expect(sprite.rotation).toBeCloseTo(-point.angulo * Math.PI / 180);
        road.startAngle = 90;
        cars.updateAll([road]);
        expect(sprite.x).not.toBeCloseTo(point.x);
        expect(sprite.rotation).toBeCloseTo(Math.PI + (Math.PI / road.tamano));
        expect(links.cellCoordinates(road, 1, 4).x).toBeCloseTo(window.roundaboutStreet.coordinates(road, 1, 4).x);
    });
});
