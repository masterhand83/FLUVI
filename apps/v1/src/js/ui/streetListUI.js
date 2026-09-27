(function () {
    const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

    function sortedEntries(streets) {
        return (streets || []).map((street, index) => ({ street, index }))
            .sort((a, b) => collator.compare(a.street?.nombre || '', b.street?.nombre || '') || a.index - b.index);
    }

    function refreshSearch(select) {
        if (!select) return;
        const input = select._streetListSearchInput;
        if (!input) return;
        const query = normalize(input.value);
        Array.from(select.options).forEach(option => {
            const matches = !query || normalize(option.textContent).includes(query);
            option.hidden = !matches && !option.selected;
        });
    }

    function normalize(value) {
        return String(value || '').toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function makeSearchable(select) {
        if (!select || select._streetListSearchInput) return select;
        const input = document.createElement('input');
        input.type = 'search';
        input.className = 'form-control form-control-sm mt-1';
        input.placeholder = 'Buscar calle…';
        input.setAttribute('aria-label', 'Buscar calle');
        input.autocomplete = 'off';
        select.insertAdjacentElement('afterend', input);
        select._streetListSearchInput = input;
        input.addEventListener('input', () => refreshSearch(select));
        select.addEventListener('change', () => refreshSearch(select));
        refreshSearch(select);
        return select;
    }

    window.streetListUI = { sortedEntries, makeSearchable, refreshSearch };
})();
