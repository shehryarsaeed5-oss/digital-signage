(function () {
  function clearRowInputs(row) {
    row.querySelectorAll('input').forEach((input) => {
      input.value = '';
    });
  }

  function rowHasContent(row) {
    return Array.from(row.querySelectorAll('input')).some((input) => String(input.value || '').trim() !== '');
  }

  function initSection(section) {
    const visibleCount = Number.parseInt(section.dataset.visibleAdRows || '3', 10);
    const rows = Array.from(section.querySelectorAll('[data-vista-ad-row]'));
    const addButton = section.querySelector('[data-vista-add-row]');

    rows.forEach((row, index) => {
      if (rowHasContent(row)) {
        row.classList.remove('is-hidden');
        return;
      }

      if (index < visibleCount) {
        row.classList.remove('is-hidden');
        return;
      }

      row.classList.add('is-hidden');
    });

    if (addButton) {
      addButton.addEventListener('click', () => {
        const nextHiddenRow = rows.find((row) => row.classList.contains('is-hidden'));
        if (!nextHiddenRow) {
          return;
        }

        nextHiddenRow.classList.remove('is-hidden');
        const firstInput = nextHiddenRow.querySelector('input');
        if (firstInput) {
          firstInput.focus();
        }
      });
    }

    section.querySelectorAll('[data-vista-remove-row]').forEach((button) => {
      button.addEventListener('click', () => {
        const row = button.closest('[data-vista-ad-row]');
        if (!row) {
          return;
        }

        clearRowInputs(row);
        row.classList.add('is-hidden');
      });
    });
  }

  document.querySelectorAll('[data-vista-day-section]').forEach(initSection);

  document.querySelectorAll('[data-vista-print-button]').forEach((button) => {
    button.addEventListener('click', () => {
      window.print();
    });
  });
})();
