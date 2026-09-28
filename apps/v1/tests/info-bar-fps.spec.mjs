import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/js/ui/infoBar.js', import.meta.url), 'utf8');

describe('simulation FPS counter', () => {
  it('measures completed steps over elapsed time and clears on pause/reset', () => {
    const fps = { textContent: '0.0' };
    let now = 0;
    const window = { addEventListener() {} };
    const document = {
      addEventListener() {},
      getElementById(id) { return id === 'infoFPS' ? fps : null; },
    };
    runInNewContext(source, { window, document, performance: { now: () => now }, console: { log() {} } });

    window.recordSimulationFrame();
    now = 500;
    window.recordSimulationFrame();
    expect(fps.textContent).toBe('0.0');
    now = 1000;
    window.recordSimulationFrame();
    expect(fps.textContent).toBe('3.0');

    window.resetSimulationFPS();
    expect(fps.textContent).toBe('0.0');
    now = 2000;
    window.recordSimulationFrame();
    expect(fps.textContent).toBe('0.0');
    now = 3000;
    window.recordSimulationFrame();
    expect(fps.textContent).toBe('2.0');

    window.resetSimulationInfo();
    expect(fps.textContent).toBe('0.0');
  });
});
