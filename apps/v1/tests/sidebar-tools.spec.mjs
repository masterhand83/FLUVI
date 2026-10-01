import { describe, expect, it } from 'vitest';
import { openSimulator } from './helpers/simulator.mjs';

describe('Herramientas sidebar section', () => {
    it('sits between About and street settings and starts link creation', async () => {
        const simulator = await openSimulator();
        try {
            const { page } = simulator;
            const headings = await page.$$eval('#controlPanelAccordion > .accordion-item > .accordion-header',
                elements => elements.map(element => element.textContent.trim()));
            expect(headings.slice(0, 4)).toEqual(['ℹ️ Sobre FLUVI', '✏️ Herramientas', '🏗️ Constructor de Mapas', '⚙️ Configuración de Calles']);
            expect(await page.$$eval('#createLinkButton', elements => elements.length)).toBe(1);
            expect(await page.$('#collapseMapDrawingTools #createLinkButton')).not.toBeNull();
            expect(await page.$('#controlBar #createLinkButton')).toBeNull();

            await page.evaluate(() => { document.getElementById('loadingScreen').style.display = 'none'; });
            await page.click('[data-bs-target="#collapseMapDrawingTools"]');
            await page.waitForSelector('#collapseMapDrawingTools.show', { visible: true });
            await page.click('#createLinkButton');
            await page.waitForSelector('#linkDraftPanel', { visible: true });
            const placement = await page.$eval('#linkDraftPanel', panel => {
                const rect = panel.getBoundingClientRect();
                const map = panel.parentElement.getBoundingClientRect();
                return { parent: panel.parentElement.className, top: rect.top - map.top, left: rect.left - map.left,
                    fits: rect.right <= map.right && rect.bottom <= map.bottom };
            });
            expect(placement.parent).toBe('canvas-wrapper');
            expect(placement.top).toBeCloseTo(12);
            expect(placement.left).toBeCloseTo(12);
            expect(placement.fits).toBe(true);
            await page.click('#linkCancelButton');
            await page.waitForSelector('#linkDraftPanel', { hidden: true });
        } finally {
            await simulator.close();
        }
    });
});
