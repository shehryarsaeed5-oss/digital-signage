(() => {
  const screenOptions = {
    cinema: 'Cinema Player',
    'cinema-3x2': 'Cinema Player 3x2',
    'cinema-portrait': 'Cinema Portrait Player',
  };

  const normalizeScreenId = (screen) => {
    const value = String(screen || '').toLowerCase().trim();
    if (!value) return '';
    if (value === 'portrait') return 'cinema-portrait';
    if (value === '3x2') return 'cinema-3x2';
    if (value === 'cinema-player') return 'cinema';
    return value;
  };

  const defaults = {
    now_showing_duration_seconds: 8,
    coming_soon_duration_seconds: 5,
    enable_ads: true,
    ad_frequency_movies: 2,
    ...(window.__PLAYER_SETTINGS_DEFAULTS__ || {}),
  };

  const form = document.getElementById('screen-player-settings-form');
  const screenSelect = document.getElementById('player-settings-screen');
  const tableBody = document.getElementById('screen-settings-table-body');
  const rowTemplate = document.getElementById('screen-settings-row-template');
  const loadingEl = document.getElementById('screen-settings-loading');
  const errorEl = document.getElementById('screen-settings-error');
  const emptyEl = document.getElementById('screen-settings-empty');
  const screenCard = document.getElementById('screen-player-settings-card');
  const resetButton = document.getElementById('screen-settings-reset-button');
  const submitButton = form?.querySelector('button[type="submit"]');

  if (!form || !screenSelect || !tableBody || !loadingEl || !errorEl || !emptyEl) {
    console.warn('Player settings screen manager skipped because required elements are missing.');
    return;
  }

  let savedSettings = [];
  let savedSettingsMap = new Map();

  const fieldNames = [
    'now_showing_duration_seconds',
    'coming_soon_duration_seconds',
    'enable_ads',
    'ad_frequency_movies',
  ];

  const setLoading = (isLoading) => {
    loadingEl.classList.toggle('hidden', !isLoading);
  };

  const setError = (message) => {
    errorEl.textContent = message || '';
    errorEl.classList.toggle('hidden', !message);
  };

  const getScreenLabel = (screen) => screenOptions[screen] || screen;

  const normalizeRecord = (record) => ({
    screen: normalizeScreenId(record?.screen || ''),
    now_showing_duration_seconds: Number.parseInt(record?.now_showing_duration_seconds, 10),
    coming_soon_duration_seconds: Number.parseInt(record?.coming_soon_duration_seconds, 10),
    enable_ads: Boolean(record?.enable_ads),
    ad_frequency_movies: Number.parseInt(record?.ad_frequency_movies, 10),
    updated_at: record?.updated_at || '',
  });

  const getFormValuesForScreen = (screen) => {
    const record = savedSettingsMap.get(screen);
    return record || {
      screen,
      ...defaults,
    };
  };

  const applySettingsToForm = (screen, overrideValues = null) => {
    const values = overrideValues || getFormValuesForScreen(screen);
    screenSelect.value = screen;

    const nowShowingInput = form.querySelector('input[name="now_showing_duration_seconds"]');
    const comingSoonInput = form.querySelector('input[name="coming_soon_duration_seconds"]');
    const enableAdsInput = form.querySelector('input[name="enable_ads"]');
    const adFrequencyInput = form.querySelector('input[name="ad_frequency_movies"]');

    if (nowShowingInput) {
      nowShowingInput.value = values.now_showing_duration_seconds ?? defaults.now_showing_duration_seconds;
    }

    if (comingSoonInput) {
      comingSoonInput.value = values.coming_soon_duration_seconds ?? defaults.coming_soon_duration_seconds;
    }

    if (enableAdsInput) {
      enableAdsInput.checked = values.enable_ads !== false;
    }

    if (adFrequencyInput) {
      adFrequencyInput.value = values.ad_frequency_movies ?? defaults.ad_frequency_movies;
    }
  };

  const renderTable = () => {
    tableBody.innerHTML = '';

    if (savedSettings.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    emptyEl.classList.add('hidden');

    savedSettings.forEach((record) => {
      const templateRow = rowTemplate?.content?.firstElementChild;
      const row = templateRow ? templateRow.cloneNode(true) : document.createElement('tr');

      const screenCell = row.querySelector('[data-field="screen"]');
      const nowShowingCell = row.querySelector('[data-field="now_showing_duration_seconds"]');
      const comingSoonCell = row.querySelector('[data-field="coming_soon_duration_seconds"]');
      const enableAdsCell = row.querySelector('[data-field="enable_ads"]');
      const frequencyCell = row.querySelector('[data-field="ad_frequency_movies"]');
      const editButton = row.querySelector('button[data-screen]');

      if (screenCell) screenCell.textContent = getScreenLabel(record.screen);
      if (nowShowingCell) nowShowingCell.textContent = record.now_showing_duration_seconds ?? '—';
      if (comingSoonCell) comingSoonCell.textContent = record.coming_soon_duration_seconds ?? '—';
      if (enableAdsCell) enableAdsCell.textContent = record.enable_ads ? 'Yes' : 'No';
      if (frequencyCell) frequencyCell.textContent = record.ad_frequency_movies ?? '—';
      if (editButton) editButton.dataset.screen = record.screen;

      tableBody.appendChild(row);
    });
  };

  const loadSavedSettings = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/player-settings', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const data = payload?.data || {};
      savedSettings = Array.isArray(data.settings)
        ? data.settings.map(normalizeRecord).filter((record) => record.screen && screenOptions[record.screen])
        : [];
      savedSettingsMap = new Map(savedSettings.map((record) => [record.screen, record]));
      renderTable();
      applySettingsToForm(screenSelect.value || 'cinema');
    } catch (error) {
      console.error('Failed to load screen settings', error);
      setError('Unable to load saved screen settings.');
      savedSettings = [];
      savedSettingsMap = new Map();
      renderTable();
      applySettingsToForm(screenSelect.value || 'cinema');
    } finally {
      setLoading(false);
    }
  };

  const loadScreenSettings = async (screen) => {
    if (!screen) {
      return;
    }

    setError('');

    try {
      const response = await fetch(`/api/player-settings?screen=${encodeURIComponent(screen)}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const rawSetting = payload?.data?.setting;
      const record = rawSetting ? normalizeRecord(rawSetting) : null;

      screenSelect.value = screen;
      applySettingsToForm(screen, (record && record.screen) ? record : { screen, ...defaults });
      (screenCard || form).scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      console.error('Failed to load screen settings for edit', error);
      setError('Unable to load that screen setting.');
    }
  };

  const setSubmitState = (isSaving) => {
    if (submitButton) {
      submitButton.disabled = isSaving;
    }
    screenSelect.disabled = isSaving;
    if (resetButton) {
      resetButton.disabled = isSaving;
    }
  };

  const upsertLocalRecord = (record) => {
    const normalized = normalizeRecord(record);
    const existingIndex = savedSettings.findIndex((item) => item.screen === normalized.screen);

    if (existingIndex >= 0) {
      savedSettings[existingIndex] = normalized;
    } else {
      savedSettings.push(normalized);
    }

    savedSettings.sort((left, right) => {
      const leftIndex = Object.keys(screenOptions).indexOf(left.screen);
      const rightIndex = Object.keys(screenOptions).indexOf(right.screen);
      return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
    });

    savedSettingsMap.set(normalized.screen, normalized);
    renderTable();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const selectedScreen = screenSelect.value;
    if (!selectedScreen) {
      setError('Select a screen before saving.');
      return;
    }

    const formData = new URLSearchParams();
    formData.set('screen', selectedScreen);

    fieldNames.forEach((fieldName) => {
      const input = form.querySelector(`[name="${fieldName}"]`);
      if (!input) {
        return;
      }

      if (input.type === 'checkbox') {
        formData.set(fieldName, input.checked ? 'on' : 'off');
        return;
      }

      formData.set(fieldName, input.value);
    });

    setSubmitState(true);
    setError('');

    try {
      const response = await fetch('/admin/player-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: 'application/json',
        },
        body: formData.toString(),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to save screen settings.');
      }

      await loadSavedSettings();
      applySettingsToForm(selectedScreen);
    } catch (error) {
      console.error('Failed to save screen settings', error);
      setError(error.message || 'Unable to save screen settings.');
    } finally {
      setSubmitState(false);
    }
  };

  screenSelect.addEventListener('change', () => {
    applySettingsToForm(screenSelect.value);
    setError('');
  });

  tableBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-screen]');
    if (!button || !tableBody.contains(button)) {
      return;
    }

    void loadScreenSettings(button.dataset.screen);
  });

  if (resetButton) {
    resetButton.addEventListener('click', () => {
      applySettingsToForm(screenSelect.value || 'cinema');
      setError('');
    });
  }

  form.addEventListener('submit', handleSubmit);
  applySettingsToForm(screenSelect.value || 'cinema');
  void loadSavedSettings();
})();
