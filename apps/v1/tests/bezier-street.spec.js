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

    it('normalizes legacy and multi-section geometry without exposing mutable input', () => {
        const legacy = road();
        expect(api.isBezier(legacy)).toBe(true);
        expect(api.isBezier({ x: 0, y: 0 })).toBe(false);
        const normalized = api.segments(legacy);
        expect(normalized).toEqual([{ controls: [{ x: 50, y: 50 }], end: { x: 100, y: 0 } }]);
        normalized[0].controls[0].x = 999;
        expect(legacy.bezierControls[0].x).toBe(50);
    });

    it('splits a curved section exactly and preserves all points on its shape', () => {
        const street = road({ bezierControls: [{ x: 20, y: 60 }, { x: 80, y: 60 }] });
        const before = Array.from({ length: 101 }, (_, i) => api.point(street, i / 100));
        const sections = api.splitSegment(street, 0, 0.25);
        const result = { ...street, bezierSegments: sections };
        before.forEach((p, i) => {
            const t = i / 100;
            const after = api.point(result, t <= 0.25 ? t / 0.25 / 2 : (1 + (t - 0.25) / 0.75) / 2);
            expect(after.x).toBeCloseTo(p.x, 8);
            expect(after.y).toBeCloseTo(p.y, 8);
        });
        expect(street.bezierControls).toHaveLength(2);
        expect(sections[0].end).toEqual(api.point(street, 0.25));
    });

    it('retains sharp corners, proportional section parameters and arc-length cells', () => {
        const street = road({ bezierControls: undefined, endX: 40, endY: 40, carriles: 1,
            bezierSegments: [
                { controls: [], end: { x: 40, y: 0 } },
                { controls: [], end: { x: 40, y: 40 } }
            ] });
        expect(api.point(street, 0.5)).toEqual({ x: 40, y: 0 });
        expect(api.point(street, 0.75)).toEqual({ x: 40, y: 20 });
        expect(api.coordinates(street, 0, 7).angulo).toBeCloseTo(0);
        expect(api.coordinates(street, 0, 8).angulo).toBeCloseTo(-90);
        expect(api.coordinates(street, 0, 8).x).toBeCloseTo(40);
        expect(api.validate(street).valid).toBe(true);
        const pieces = api.splitSegment(street, 0);
        expect(pieces[0]).toEqual({ controls: [], end: { x: 20, y: 0 } });
        expect(pieces[1]).toEqual({ controls: [], end: { x: 40, y: 0 } });
    });

    it('keeps the other side of an anchor fixed when one section control moves', () => {
        const street = road({ bezierControls: undefined, endX: 120, endY: 0, carriles: 1,
            bezierSegments: [
                { controls: [{ x: 20, y: 20 }], end: { x: 60, y: 0 } },
                { controls: [{ x: 90, y: -20 }], end: { x: 120, y: 0 } }
            ] });
        const anchor = api.point(street, 0.5);
        const farSide = api.point(street, 0.75);
        const nearSide = api.point(street, 0.25);
        street.bezierSegments[0].controls[0].y += 15;
        expect(api.point(street, 0.5)).toEqual(anchor);
        expect(api.point(street, 0.75)).toEqual(farSide);
        expect(api.point(street, 0.25)).not.toEqual(nearSide);
    });

    it('allows ordinary multi-lane right-angle turns at an anchor', () => {
        for (const carriles of [2, 4]) {
            const street = road({ bezierControls: undefined, endX: 50, endY: 50, carriles,
                bezierSegments: [
                    { controls: [], end: { x: 50, y: 0 } },
                    { controls: [], end: { x: 50, y: 50 } }
                ] });
            expect(api.validate(street).valid).toBe(true);
        }
    });

    it('does not treat a reversal at an anchor as a valid corner', () => {
        const street = road({ bezierControls: undefined, endX: 0, endY: 0, carriles: 2,
            bezierSegments: [
                { controls: [], end: { x: 50, y: 0 } },
                { controls: [], end: { x: 0, y: 0 } }
            ] });
        expect(api.validate(street).reason).toBe('folded-lane-overlap');
    });

    it('invalidates cached length and rejects malformed anchors', () => {
        const street = road({ bezierControls: undefined, endX: 100, endY: 0,
            bezierSegments: [{ controls: [], end: { x: 50, y: 0 } }, { controls: [], end: { x: 100, y: 0 } }] });
        expect(api.validate(street).length).toBeCloseTo(100);
        street.bezierSegments[0].end.y = 50;
        expect(api.validate(street).length).toBeGreaterThan(140);
        street.bezierSegments[0].end.x = NaN;
        expect(api.validate(street).reason).toBe('invalid-controls');
        street.bezierSegments[0].end.x = 50;
        street.bezierSegments[1].end.x = 101;
        expect(api.validate(street).reason).toBe('invalid-controls');
    });
});
