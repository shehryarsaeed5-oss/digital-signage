const adminAdEdit = (() => {
  const form = document.querySelector('#ad-edit-form');
  const messageEl = document.querySelector('#ad-edit-message');
  const submitButton = form?.querySelector('button[type="submit"]');

  const toggleMessage = (type, text) => {
    if (!messageEl) {
      return;
    }

    messageEl.classList.remove('hidden', 'success', 'error');
    messageEl.classList.add(type === 'error' ? 'error' : 'success');
    messageEl.textContent = text;
  };

  const disableSubmit = (disabled) => {
    if (submitButton) {
      submitButton.disabled = disabled;
    }
  };

  const parseScreenTargets = (rawValue) => {
    if (!rawValue) {
      return [];
    }

    return rawValue
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form) {
      return;
    }

    const adId = form.dataset.adId;
    if (!adId) {
      toggleMessage('error', 'Unable to identify the ad.');
      return;
    }

    const titleInput = form.querySelector('input[name="title"]');
    const durationInput = form.querySelector('input[name="duration_seconds"]');
    const statusSelect = form.querySelector('select[name="status"]');
    const screensInput = form.querySelector('input[name="screen_targets"]');

    const title = titleInput?.value?.trim() || '';
    const rawDuration = durationInput?.value;
    const durationValue = rawDuration ? Number.parseInt(rawDuration, 10) : null;
    const duration = Number.isFinite(durationValue) ? durationValue : null;
    const status = (statusSelect?.value || 'inactive').toLowerCase();
    const screenTargets = parseScreenTargets(screensInput?.value);

    const payload = {
      title,
      status,
      duration,
      screens: screenTargets,
    };

    try {
      disableSubmit(true);
      toggleMessage('success', 'Saving…');
      const response = await fetch(`/api/ads/${encodeURIComponent(adId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const payload = await response
          .json()
          .catch(() => ({ error: 'Unable to parse server response.' }));
        const errorMessage = payload?.error || 'Unable to save ad. Try again.';
        console.error('Ad update failed', payload);
        toggleMessage('error', errorMessage);
        return;
      }

      const updatedAd = await response.json().catch(() => null);
      console.log('Ad updated', updatedAd);
      toggleMessage('success', 'Ad updated successfully. Redirecting…');
      setTimeout(() => {
        window.location.href = '/admin/ads/new';
      }, 900);
    } catch (error) {
      console.error('Ad update request failed', error);
      toggleMessage('error', 'Request failed. Check the console and try again.');
    } finally {
      disableSubmit(false);
    }
  };

  if (!form) {
    return null;
  }

  form.addEventListener('submit', handleSubmit);

  return {
    submit: handleSubmit,
  };
})();
