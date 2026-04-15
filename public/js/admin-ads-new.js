const adminAdsList = (() => {
  const selectors = {
    tableBody: '#ads-table-body',
    loading: '#ads-loading',
    error: '#ads-error',
    emptyState: '#ads-empty',
    tableWrapper: '.ads-table-wrapper',
    refreshButton: '#ads-refresh-button',
  };

  const getElement = (selector) => document.querySelector(selector);

  const tableBody = getElement(selectors.tableBody);
  const loadingEl = getElement(selectors.loading);
  const errorEl = getElement(selectors.error);
  const emptyEl = getElement(selectors.emptyState);
  const tableWrapperEl = getElement(selectors.tableWrapper);
  const refreshButton = getElement(selectors.refreshButton);

  if (!tableBody || !loadingEl || !errorEl || !emptyEl || !tableWrapperEl) {
    console.warn('Ads list initialization skipped because a container is missing.');
    return null;
  }

  let ads = [];
  let isLoading = false;
  let errorMessage = '';

  const setLoading = (value) => {
    isLoading = value;
    updateVisibility();
  };

  const setError = (message) => {
    errorMessage = message;
    if (errorEl) {
      errorEl.textContent = message;
    }
    updateVisibility();
  };

  const updateVisibility = () => {
    const hasAds = Array.isArray(ads) && ads.length > 0;
    loadingEl.classList.toggle('hidden', !isLoading);
    const showError = Boolean(errorMessage);
    errorEl.classList.toggle('hidden', !showError);
    emptyEl.classList.toggle('hidden', hasAds || isLoading || showError);
    tableWrapperEl.classList.toggle('hidden', isLoading || showError || !hasAds);
  };

  const refresh = async () => {
    setError('');
    setLoading(true);
    try {
      console.log('Fetching ads list...');
      const response = await fetch('/api/ads?status=active&eligible=0');
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error('Unexpected response payload when loading ads.');
      }
      ads = payload;
      console.log('Loaded ads:', ads.length);
      renderRows(ads);
    } catch (error) {
      console.error('Unable to load ads list', error);
      setError('Unable to load ads. Try again or refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const createActionButton = (label, variant, handler) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = `ads-action-button ${variant}`.trim();
    button.addEventListener('click', handler);
    return button;
  };

  const formatDuration = (value) => {
    const numericValue = Number.parseInt(value, 10);
    const totalSeconds = Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const renderRows = (items) => {
    tableBody.innerHTML = '';
    if (!Array.isArray(items)) {
      return;
    }

    items.forEach((ad) => {
      const row = document.createElement('tr');

      const titleCell = document.createElement('td');
      titleCell.textContent = ad.title || 'Untitled ad';
      row.appendChild(titleCell);

      const durationCell = document.createElement('td');
      durationCell.textContent = formatDuration(ad.duration_seconds ?? ad.duration ?? 0);
      row.appendChild(durationCell);

      const statusCell = document.createElement('td');
      statusCell.textContent = (ad.status || 'inactive').replace(/(^|\s)(\S)/g, (m) =>
        m.toUpperCase()
      );
      row.appendChild(statusCell);

      const screensCell = document.createElement('td');
      const screens = Array.isArray(ad.screenTargets) ? ad.screenTargets : [];
      screensCell.textContent = screens.length ? screens.join(', ') : 'All screens';
      row.appendChild(screensCell);

      const actionsCell = document.createElement('td');
      const actionGroup = document.createElement('div');
      actionGroup.className = 'ads-action-group';

      const editButton = createActionButton('Edit', 'is-neutral', () => {
        window.location.href = `/admin/ads/edit/${ad.id}`;
      });

      const deleteButton = createActionButton('Delete', 'is-danger', async () => {
        const confirmed = window.confirm('Are you sure you want to delete this ad?');
        if (!confirmed) {
          return;
        }
        await deleteAd(ad.id);
      });

      actionGroup.appendChild(editButton);
      actionGroup.appendChild(deleteButton);
      actionsCell.appendChild(actionGroup);
      row.appendChild(actionsCell);

      tableBody.appendChild(row);
    });

    updateVisibility();
  };

  const deleteAd = async (id) => {
    try {
      setLoading(true);
      setError('');
      console.log('Deleting ad', id);
      const response = await fetch(`/api/ads/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      await refresh();
    } catch (error) {
      console.error('Delete request failed', error);
      setError('Failed to delete the ad. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const init = () => {
    if (refreshButton) {
      refreshButton.addEventListener('click', () => {
        refresh();
      });
    }
    refresh();
  };

  updateVisibility();
  init();
  return {
    refresh,
  };
})();

const adminAdUploadForm = (() => {
  const form = document.querySelector('form[enctype="multipart/form-data"]');
  const fileInput = form?.querySelector('input[name="ad_file"]');
  const durationField = document.querySelector('#ad-duration-field');
  const durationInput = document.querySelector('#ad-duration-input');
  const durationHelper = document.querySelector('#ad-duration-helper');

  if (!form || !fileInput || !durationField || !durationInput || !durationHelper) {
    return null;
  }

  const setImageMode = () => {
    durationField.classList.remove('hidden');
    durationInput.disabled = false;
    durationInput.required = true;
    durationHelper.textContent = 'Images require a duration in seconds.';
  };

  const setVideoMode = () => {
    durationField.classList.add('hidden');
    durationInput.disabled = true;
    durationInput.required = false;
    durationHelper.textContent = 'Video ads play until the file ends.';
  };

  const syncDurationState = () => {
    const fileName = String(fileInput.value || '').toLowerCase();
    if (fileName.endsWith('.mp4')) {
      setVideoMode();
      return;
    }

    setImageMode();
  };

  fileInput.addEventListener('change', syncDurationState);
  syncDurationState();

  return {
    syncDurationState,
  };
})();
