import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let api;
beforeAll(() => {
    const context = { window: { celda_tamano: 5 } };
    vm.runInNewContext(readFileSync(new URL('../src/js/core/bezierStreet.js', import.meta.url), 'utf8'), context);
    api = context.window.streetBezier;
});

const road = overrides => ({ x: 0, y: 0, endX: 100, endY: 0, bezierControls: [{ x: 50, y: 50 }], tamano: 20, carriles: 2, esCurva: true, ...overrides });

describe('streetBezier', () => {
    it('uses world-space endpoints and evaluates a Bezier point', () => {
        expect(api.point(road(), 0)).toEqual({ x: 0, y: 0 });
        expect(api.point(road(), 1)).toEqual({ x: 100, y: 0 });
        expect(api.point(road(), 0.5)).toEqual({ x: 50, y: 25 });
    });

    it('places lane cell centers by arc length and provides tangent angle', () => {
        const center = api.coordinates(road(), 0, 10);
        expect(center.x).toBeGreaterThan(35);
        expect(center.x).toBeLessThan(65);
        expect(center.y).toBeGreaterThan(20);
        expect(center.angulo).toBeTypeOf('number');
        expect(api.coordinates(road(), 1, 10).x).not.toBe(center.x);
    });

    it('validates sufficient arc length and rejects undersized roads', () => {
        expect(api.validate(road()).valid).toBe(true);
        expect(api.validate(road({ endX: 4, bezierControls: [], tamano: 20 })).reason).toBe('too-short');
        expect(api.validate(road({ bezierControls: [{ x: NaN, y: 2 }] })).reason).toBe('invalid-controls');
    });

    it('quantizes cell count from arc length, independent of the old cell count', () => {
        const result = api.validate(road({ tamano: 1 }));
        expect(result.valid).toBe(true);
        expect(result.cells).toBe(Math.round(result.length / 5));
        expect(result.cells).toBeGreaterThan(1);
        expect(api.validate(road({ endX: 12510, bezierControls: [], tamano: 1 })).reason).toBe('too-long');
    });

    it('uses fixed physical cell spacing and permits endpoint residual', () => {
        const street = road({ bezierControls: [], endX: 52, tamano: 1 });
        expect(api.coordinates(street, 0, 0).x).toBeCloseTo(2.5);
        expect(api.coordinates(street, 0, 9).x).toBeCloseTo(47.5);
        expect(api.coordinates(street, 0, 10).x).toBeCloseTo(52);
    });

    it('rejects self-folding geometry', () => {
        const folded = road({ x: 0, y: 0, endX: 0, endY: 0, bezierControls: [{ x: 100, y: 0 }, { x: -100, y: 0 }], tamano: 20, carriles: 1 });
        expect(api.validate(folded).reason).toBe('folded-lane-overlap');
    });

    it('validates long, many-lane streets without pairwise segment scanning', () => {
        const longRoad = road({ endX: 6000, endY: 0, bezierControls: [], tamano: 1, carriles: 10 });
        const result = api.validate(longRoad);
        expect(result.valid).toBe(true);
        expect(result.cells).toBe(1200);
    });

    it('rejects overlapping offset lanes on a tight fold', () => {
        const foldedLanes = road({ x: 0, y: 0, endX: 0, endY: 0, bezierControls: [{ x: 100, y: 0 }, { x: 100, y: 5 }], tamano: 1, carriles: 4 });
        expect(api.validate(foldedLanes).reason).toBe('folded-lane-overlap');
    });
});
