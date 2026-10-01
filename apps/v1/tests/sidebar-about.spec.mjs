import { describe, expect, it } from 'vitest';
import { openSimulator } from './helpers/simulator.mjs';

describe('Sobre FLUVI sidebar section', () => {
    it('combines project information and instructions and opens both existing modals', async () => {
        const simulator = await openSimulator();
        try {
            const { page } = simulator;
            const headings = await page.$$eval('#controlPanelAccordion > .accordion-item > .accordion-header',
                elements => elements.map(element => element.textContent.trim()));
            expect(headings.filter(text => text.includes('Sobre FLUVI'))).toHaveLength(1);
            expect(headings.some(text => /Instrucciones|Acerca de FLUVI/.test(text))).toBe(false);
            expect(await page.$eval('#collapseAbout', element => element.classList.contains('show'))).toBe(true);

            for (const modal of ['aboutModal', 'instructionsModal']) {
                await page.$eval(`#collapseAbout [data-bs-target="#${modal}"]`, button => button.click());
                await page.waitForSelector(`#${modal}.show`, { visible: true });
                await page.waitForFunction(id => document.getElementById(id).getAttribute('aria-modal') === 'true', { polling: 100 }, modal);
                await page.waitForFunction(() => !document.querySelector('.modal.show .modal-dialog')?.getAnimations().length, { polling: 100 });
                await page.$eval(`#${modal} [data-bs-dismiss="modal"]`, button => button.click());
                await page.waitForSelector(`#${modal}`, { hidden: true });
            }
        } finally {
            await simulator.close();
        }
    });
});
