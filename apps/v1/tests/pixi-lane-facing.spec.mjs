import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = (name) => readFileSync(new URL(`../src/js/renderer/renderers/${name}.js`, import.meta.url), "utf8");

function setup() {
    class Container {
        children = [];
        addChild(child) { this.children.push(child); child.parent = this; return child; }
        removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; }
        getChildByName(name) { return this.children.find(child => child.name === name); }
        destroy() {}
        on() {}
    }
    class Graphics extends Container {
        lines = [];
        lineStyle() {}
        moveTo(x, y) { this.start = [x, y]; }
        lineTo(x, y) { this.lines.push([this.start, [x, y]]); }
        drawRect() {}
    }
    class Sprite extends Container {
        anchor = { set() {} };
    }
    class TilingSprite extends Sprite {
        constructor(texture, width, height) { super(); Object.assign(this, { texture, width, height }); }
        tileScale = { set() {} };
    }
    const window = { celda_tamano: 5, isPaused: true, getLaneDirection: (street, lane) => street.laneDirections?.[lane] === -1 ? -1 : 1 };
    const layer = new Container();
    const scene = { calleSprites: new Map(), carroSprites: new Map(), getLayer: () => layer };
    const context = { window, PIXI: { Container, Graphics, Sprite, TilingSprite }, CoordinateConverter: { degreesToRadians: (angle) => angle * Math.PI / 180 }, console };
    runInNewContext(source("CalleRenderer"), context);
    runInNewContext(source("CarroRenderer"), context);
    const assets = { getTexture: (name) => ({ name, width: 5, height: 5 }) };
    const roads = new window.CalleRenderer(scene, assets);
    const cars = new window.CarroRenderer(scene, assets);
    const street = { nombre: "R", x: 10, y: 20, angulo: 0, carriles: 2, tamano: 8,
        laneDirections: [1, 1], arreglo: [[2, 0, 0, 0, 0, 0, 0, 0], [3, 0, 0, 0, 0, 0, 0, 0]] };
    return { window, scene, roads, cars, street, layer };
}

describe("Pixi lane directions", () => {
    it("draws noninteractive arrows for both lanes on a mixed straight street and refreshes them in place", () => {
        const { roads, scene, street } = setup();
        roads.renderCalleRecta(street);
        const container = scene.calleSprites.get(street);
        expect(container.getChildByName("laneDirectionArrows")).toBeUndefined();
        street.laneDirections[1] = -1;
        roads.renderCalleRecta(street); // renderAll revisits the existing container
        const arrows = container.getChildByName("laneDirectionArrows");
        expect(arrows.eventMode).toBe("none");
        expect(arrows.lines).toHaveLength(6); // three strokes in each lane
        expect(arrows.lines[0][1][0]).toBeGreaterThan(arrows.lines[0][0][0]);
        expect(arrows.lines[3][1][0]).toBeLessThan(arrows.lines[3][0][0]);
        expect(container.children[0].eventMode).toBe("static");
        street.laneDirections[1] = 1;
        roads.renderCalleRecta(street);
        expect(container.getChildByName("laneDirectionArrows")).toBeUndefined();
    });

    it("uses curved cell positions and angles, keeping cell hit targets above/below only noninteractive cues", () => {
        const { window, roads, scene, street } = setup();
        street.esCurva = true;
        street.laneDirections[1] = -1;
        window.obtenerCoordenadasGlobalesCeldaConCurva = (_street, lane, index) => ({ x: index * 5, y: lane * 5, angulo: 90 });
        roads.renderCalleCurva(street);
        const container = scene.calleSprites.get(street);
        const arrows = container.getChildByName("laneDirectionArrows");
        expect(arrows.eventMode).toBe("none");
        expect(arrows.lines).toHaveLength(6);
        expect(arrows.lines[0][1][1]).toBeGreaterThan(arrows.lines[0][0][1]);
        expect(arrows.lines[3][1][1]).toBeLessThan(arrows.lines[3][0][1]);
        expect(container.children[0].eventMode).toBe("static");
        roads.renderCalleCurva(street);
        expect(scene.calleSprites.get(street).getChildByName("laneDirectionArrows").lines).toHaveLength(6);
    });

    it("turns existing vehicles after a paused direction edit, including curved and reused sprites", () => {
        const { window, cars, scene, street } = setup();
        cars.updateAll([street]);
        const forward = scene.carroSprites.get("R_0_0");
        const reverse = scene.carroSprites.get("R_1_0");
        street.laneDirections[1] = -1;
        cars.updateAll([street]); // same cell values, as in SceneManager.renderAll
        expect(scene.carroSprites.get("R_0_0")).toBe(forward);
        expect(scene.carroSprites.get("R_1_0")).toBe(reverse);
        expect(forward.rotation).toBe(0);
        expect(reverse.rotation).toBe(Math.PI);
        street.esCurva = true;
        window.obtenerCoordenadasGlobalesCeldaConCurva = () => ({ x: 40, y: 50, angulo: 45 });
        cars.updateCell(street, 1, 0);
        expect(reverse.rotation).toBeCloseTo(5 * Math.PI / 4);
        street.arreglo[1][0] = 0;
        cars.updateCell(street, 1, 0);
        street.arreglo[1][0] = 4;
        cars.updateCell(street, 1, 0);
        expect(scene.carroSprites.get("R_1_0").rotation).toBeCloseTo(5 * Math.PI / 4);
    });
});
