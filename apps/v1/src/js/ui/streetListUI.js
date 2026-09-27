(function () {
    const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

    function sortedEntries(streets) {
        return (streets || []).map((street, index) => ({ street, index }))
            .sort((a, b) => collator.compare(a.street?.nombre || '', b.street?.nombre || '') || a.index - b.index);
    }

    window.streetListUI = { sortedEntries };
})();
