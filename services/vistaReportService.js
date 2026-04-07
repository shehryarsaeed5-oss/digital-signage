const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const DAY_LABELS = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [value];
}

function trimValue(value) {
  return String(value ?? '').trim();
}

function parseDate(value, label, errors) {
  const text = trimValue(value);
  if (!text) {
    errors.push(`${label} is required.`);
    return '';
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    errors.push(`${label} must be a valid date.`);
    return '';
  }

  return text;
}

function parseNumber(value, label, errors, options = {}) {
  const text = trimValue(value);
  if (!text) {
    return 0;
  }

  const numericValue = options.integer === false
    ? Number.parseFloat(text)
    : Number.parseInt(text, 10);

  if (!Number.isFinite(numericValue)) {
    errors.push(`${label} must be a valid number.`);
    return 0;
  }

  if (options.min !== undefined && numericValue < options.min) {
    errors.push(`${label} must be at least ${options.min}.`);
    return 0;
  }

  if (options.max !== undefined && numericValue > options.max) {
    errors.push(`${label} must be no more than ${options.max}.`);
    return 0;
  }

  return numericValue;
}

function parseMmSs(value, label, errors) {
  const text = trimValue(value);
  if (!text) {
    return null;
  }

  const parts = text.split(':');
  if (parts.length !== 2) {
    errors.push(`${label} must use mm:ss format.`);
    return null;
  }

  const minutes = Number.parseInt(parts[0], 10);
  const seconds = Number.parseInt(parts[1], 10);

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || minutes < 0 || seconds < 0 || seconds > 59) {
    errors.push(`${label} must use a valid mm:ss value.`);
    return null;
  }

  return minutes * 60 + seconds;
}

function pluralize(value, singular) {
  return Number(value) === 1 ? singular : `${singular}s`;
}

function formatReadableTime(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    if (minutes > 0) {
      return `${hours} ${pluralize(hours, 'hour')} ${minutes} ${pluralize(minutes, 'minute')}`;
    }

    return `${hours} ${pluralize(hours, 'hour')}`;
  }

  if (minutes > 0) {
    return `${minutes} min ${remainingSeconds} sec`;
  }

  return `${remainingSeconds} sec`;
}

function buildDailyCalculation(sectionInput) {
  const errors = [];
  const siteName = trimValue(sectionInput.site_name);
  const reportDate = parseDate(sectionInput.report_date, 'Report date', errors);
  const screenOnTimeHours = parseNumber(sectionInput.screen_on_time_hours, 'Screen ON time', errors, {
    min: 0,
    integer: false,
  });
  const totalMoviePostersCount = parseNumber(sectionInput.total_movie_posters_count, 'Total movie posters count', errors, {
    min: 0,
  });
  const secondsPerMoviePoster = parseNumber(sectionInput.seconds_per_movie_poster, 'Seconds per movie poster', errors, {
    min: 0,
  });
  const elevateRepeatCount = parseNumber(sectionInput.elevate_repeat_count, 'Elevate repeat count', errors, {
    min: 0,
  });
  const secondsPerElevatePlay = parseNumber(sectionInput.seconds_per_elevate_play, 'Seconds per Elevate play', errors, {
    min: 0,
  });

  if (!siteName) {
    errors.push('Site / screen name is required.');
  }

  const adNames = toArray(sectionInput.other_ads?.name);
  const adDurations = toArray(sectionInput.other_ads?.duration);
  const adPlays = toArray(sectionInput.other_ads?.plays);
  const rowCount = Math.max(adNames.length, adDurations.length, adPlays.length);
  const otherAds = [];

  for (let index = 0; index < rowCount; index += 1) {
    const name = trimValue(adNames[index]);
    const durationValue = trimValue(adDurations[index]);
    const playsValue = trimValue(adPlays[index]);

    if (!name && !durationValue && !playsValue) {
      continue;
    }

    if (!name) {
      errors.push(`Other ad row ${index + 1} requires a name.`);
      continue;
    }

    if (!durationValue) {
      errors.push(`Other ad row ${index + 1} requires a duration in mm:ss format.`);
      continue;
    }

    if (!playsValue) {
      errors.push(`Other ad row ${index + 1} requires a playlist play count.`);
      continue;
    }

    const durationSeconds = parseMmSs(durationValue, `Other ad row ${index + 1} duration`, errors);
    const playsInPlaylist = parseNumber(playsValue, `Other ad row ${index + 1} plays`, errors, {
      min: 0,
    });

    if (durationSeconds === null) {
      continue;
    }

    if (durationSeconds <= 0) {
      errors.push(`Other ad row ${index + 1} duration must be greater than 00:00.`);
      continue;
    }

    otherAds.push({
      name,
      duration_seconds: durationSeconds,
      plays_in_playlist: Math.round(playsInPlaylist),
    });
  }

  const moviePostersTotal = (totalMoviePostersCount * secondsPerMoviePoster) / 86400;
  const elevateTotal = (elevateRepeatCount * secondsPerElevatePlay) / 86400;
  const otherAdsTotal = otherAds.reduce((sum, ad) => sum + ((ad.duration_seconds * ad.plays_in_playlist) / 86400), 0);
  const singlePlaylistTotal = moviePostersTotal + elevateTotal + otherAdsTotal;
  const playlistLoops = singlePlaylistTotal === 0 ? 0 : (screenOnTimeHours / 24) / singlePlaylistTotal;
  const oneHourFactor = singlePlaylistTotal === 0 ? 0 : 1 / 24 / singlePlaylistTotal;

  const rows = [];

  const moviePlaysOneHour = Math.round(totalMoviePostersCount * oneHourFactor);
  const moviePlaysOneDay = Math.round(totalMoviePostersCount * playlistLoops);
  const movieScreenTimeSeconds = moviePlaysOneDay * secondsPerMoviePoster;
  rows.push({
    item_type: 'movie',
    item_name: 'Movies Poster',
    duration_seconds: secondsPerMoviePoster,
    plays_in_playlist: totalMoviePostersCount,
    plays_one_hour: moviePlaysOneHour,
    plays_in_period: moviePlaysOneDay,
    total_screen_time_seconds: movieScreenTimeSeconds,
    readable_time: formatReadableTime(movieScreenTimeSeconds),
  });

  const elevatePlaysOneHour = Math.round(elevateRepeatCount * oneHourFactor);
  const elevatePlaysOneDay = Math.round(elevateRepeatCount * playlistLoops);
  const elevateScreenTimeSeconds = elevatePlaysOneDay * secondsPerElevatePlay;
  rows.push({
    item_type: 'elevate',
    item_name: 'Elevate',
    duration_seconds: secondsPerElevatePlay,
    plays_in_playlist: elevateRepeatCount,
    plays_one_hour: elevatePlaysOneHour,
    plays_in_period: elevatePlaysOneDay,
    total_screen_time_seconds: elevateScreenTimeSeconds,
    readable_time: formatReadableTime(elevateScreenTimeSeconds),
  });

  otherAds.forEach((ad, index) => {
    const playsOneHour = Math.round(ad.plays_in_playlist * oneHourFactor);
    const playsOneDay = Math.round(ad.plays_in_playlist * playlistLoops);
    const screenTimeSeconds = playsOneDay * ad.duration_seconds;

    rows.push({
      item_type: 'ad',
      item_name: ad.name,
      duration_seconds: ad.duration_seconds,
      plays_in_playlist: ad.plays_in_playlist,
      plays_one_hour: playsOneHour,
      plays_in_period: playsOneDay,
      total_screen_time_seconds: screenTimeSeconds,
      readable_time: formatReadableTime(screenTimeSeconds),
      sort_order: index,
    });
  });

  const totalRuntimeSeconds = rows.reduce((sum, row) => sum + row.total_screen_time_seconds, 0);
  const totalAdsRuns = rows
    .filter((row) => row.item_type === 'ad')
    .reduce((sum, row) => sum + row.plays_in_period, 0);

  return {
    errors,
    input: {
      report_date: reportDate,
      site_name: siteName,
      screen_on_time_hours: screenOnTimeHours,
      total_movie_posters_count: totalMoviePostersCount,
      seconds_per_movie_poster: secondsPerMoviePoster,
      elevate_repeat_count: elevateRepeatCount,
      seconds_per_elevate_play: secondsPerElevatePlay,
      other_ads: otherAds,
    },
    calculation: {
      movie_posters_total: moviePostersTotal,
      elevate_total: elevateTotal,
      other_ads_total: otherAdsTotal,
      single_playlist_total: singlePlaylistTotal,
      playlist_loops: playlistLoops,
      one_hour_factor: oneHourFactor,
    },
    rows,
    summary: {
      totalMoviesPoster: moviePlaysOneDay,
      adsRun: totalAdsRuns,
      elevate: elevatePlaysOneDay,
      onTimeHours: screenOnTimeHours,
      totalRuntimeSeconds,
    },
  };
}

function calculateDailyReportFromForm(dailyInput) {
  const parsed = buildDailyCalculation(dailyInput || {});
  const formData = {
    report_date: trimValue(dailyInput?.report_date),
    site_name: trimValue(dailyInput?.site_name),
    screen_on_time_hours: trimValue(dailyInput?.screen_on_time_hours),
    total_movie_posters_count: trimValue(dailyInput?.total_movie_posters_count),
    seconds_per_movie_poster: trimValue(dailyInput?.seconds_per_movie_poster),
    elevate_repeat_count: trimValue(dailyInput?.elevate_repeat_count),
    seconds_per_elevate_play: trimValue(dailyInput?.seconds_per_elevate_play),
    other_ads: {
      name: toArray(dailyInput?.other_ads?.name),
      duration: toArray(dailyInput?.other_ads?.duration),
      plays: toArray(dailyInput?.other_ads?.plays),
    },
  };

  if (parsed.errors.length > 0) {
    return {
      errors: parsed.errors,
      formData,
    };
  }

  const viewModel = {
    reportType: 'daily',
    title: 'Daily Report',
    subtitle: `Daily report for ${parsed.input.site_name}`,
    siteName: parsed.input.site_name,
    reportDate: parsed.input.report_date,
    weekStartDate: '',
    weekEndDate: '',
    generatedAt: new Date().toISOString(),
    summaryCards: [
      { label: 'Total Movies Poster', value: parsed.summary.totalMoviesPoster },
      { label: 'Ads Run', value: parsed.summary.adsRun },
      { label: 'Elevate (Special Ads)', value: parsed.summary.elevate },
      { label: 'ON Time (Hours)', value: Number(parsed.summary.onTimeHours).toFixed(1) },
    ],
    tableVariant: 'daily',
    tableRows: parsed.rows.map((row) => ({
      itemLabel: row.item_name,
      playsOneHour: row.plays_one_hour,
      playsInPeriod: row.plays_in_period,
      totalScreenTimeSeconds: row.total_screen_time_seconds,
      readableTime: row.readable_time,
    })),
    totalRuntimeSeconds: parsed.summary.totalRuntimeSeconds,
    totalRuntimeReadable: formatReadableTime(parsed.summary.totalRuntimeSeconds),
    printUrl: '',
  };

  const reportRecord = {
    report_type: 'daily',
    site_name: parsed.input.site_name,
    report_date: parsed.input.report_date,
    week_start_date: null,
    total_on_hours: parsed.summary.onTimeHours,
    total_movie_posters: parsed.input.total_movie_posters_count,
    seconds_per_movie_poster: parsed.input.seconds_per_movie_poster,
    elevate_repeat_count: parsed.input.elevate_repeat_count,
    seconds_per_elevate_play: parsed.input.seconds_per_elevate_play,
    computed_summary_json: JSON.stringify({
      reportType: 'daily',
      siteName: parsed.input.site_name,
      generatedAt: viewModel.generatedAt,
      totals: parsed.summary,
      calculation: parsed.calculation,
    }),
  };

  const itemRecords = parsed.rows.map((row, index) => ({
    day_key: null,
    item_type: row.item_type,
    item_name: row.item_name,
    duration_seconds: row.duration_seconds,
    plays_in_playlist: row.plays_in_playlist,
    plays_one_hour: row.plays_one_hour,
    plays_in_period: row.plays_in_period,
    total_screen_time_seconds: row.total_screen_time_seconds,
    readable_time: row.readable_time,
    sort_order: index,
  }));

  return {
    errors: [],
    formData,
    viewModel,
    reportRecord,
    itemRecords,
  };
}

function buildWeeklyCalculation(weeklyInput) {
  const errors = [];
  const siteName = trimValue(weeklyInput.site_name);
  const weekStartDate = parseDate(weeklyInput.week_start_date, 'Week start date', errors);
  const daySiteName = siteName || 'Weekly Report';
  const dayReportDate = weekStartDate || '2000-01-01';

  if (!siteName) {
    errors.push('Site / screen name is required.');
  }

  const dayResults = [];
  const daysInput = weeklyInput.days || {};

  for (const dayKey of DAY_KEYS) {
    const dayInput = daysInput[dayKey] || {};
    const dayCalculation = buildDailyCalculation({
      ...dayInput,
      site_name: daySiteName,
      report_date: dayReportDate,
    });

    if (dayCalculation.errors.length > 0) {
      dayCalculation.errors.forEach((message) => {
        errors.push(`${DAY_LABELS[dayKey]}: ${message}`);
      });
    }

    dayResults.push({
      dayKey,
      dayLabel: DAY_LABELS[dayKey],
      input: dayInput,
      calculation: dayCalculation,
    });
  }

  return {
    errors,
    input: {
      week_start_date: weekStartDate,
      site_name: siteName,
      days: daysInput,
    },
    dayResults,
  };
}

function aggregateWeeklyRows(dayResults) {
  const rowsMap = new Map();

  for (const dayResult of dayResults) {
    for (const row of dayResult.calculation.rows) {
      const key = [
        row.item_type,
        row.item_name,
        row.duration_seconds,
      ].join('|');

      if (!rowsMap.has(key)) {
        rowsMap.set(key, {
          item_type: row.item_type,
          item_name: row.item_name,
          duration_seconds: row.duration_seconds,
          plays_in_playlist: row.plays_in_playlist,
          total_plays_this_week: 0,
          total_screen_time_seconds: 0,
        });
      }

      const aggregateRow = rowsMap.get(key);
      aggregateRow.total_plays_this_week += row.plays_in_period;
      aggregateRow.total_screen_time_seconds += row.total_screen_time_seconds;
    }
  }

  return [...rowsMap.values()]
    .sort((left, right) => {
      const order = { movie: 0, elevate: 1, ad: 2 };
      const typeDelta = (order[left.item_type] ?? 99) - (order[right.item_type] ?? 99);
      if (typeDelta !== 0) {
        return typeDelta;
      }

      return left.item_name.localeCompare(right.item_name);
    })
    .map((row) => ({
      itemLabel: row.item_name,
      totalPlaysThisWeek: row.total_plays_this_week,
      avgPlaysPerDay: Number((row.total_plays_this_week / 7).toFixed(1)),
      totalWeeklyScreenTimeSeconds: row.total_screen_time_seconds,
      readableTime: formatReadableTime(row.total_screen_time_seconds),
    }));
}

function calculateWeeklyReportFromForm(weeklyInput) {
  const parsed = buildWeeklyCalculation(weeklyInput || {});
  const formData = {
    week_start_date: trimValue(weeklyInput?.week_start_date),
    site_name: trimValue(weeklyInput?.site_name),
    days: weeklyInput?.days || {},
  };

  if (parsed.errors.length > 0) {
    return {
      errors: parsed.errors,
      formData,
    };
  }

  const aggregatedRows = aggregateWeeklyRows(parsed.dayResults);
  const totalOnHoursWeek = parsed.dayResults.reduce((sum, dayResult) => {
    return sum + Number(dayResult.calculation.summary.onTimeHours || 0);
  }, 0);
  const totalMoviePosterPlaysWeek = parsed.dayResults.reduce((sum, dayResult) => {
    return sum + Number(dayResult.calculation.summary.totalMoviesPoster || 0);
  }, 0);
  const totalElevatePlaysWeek = parsed.dayResults.reduce((sum, dayResult) => {
    return sum + Number(dayResult.calculation.summary.elevate || 0);
  }, 0);
  const totalAdsRunsWeek = parsed.dayResults.reduce((sum, dayResult) => {
    return sum + Number(dayResult.calculation.summary.adsRun || 0);
  }, 0);
  const totalRuntimeSecondsWeek = aggregatedRows.reduce(
    (sum, row) => sum + Number(row.totalWeeklyScreenTimeSeconds || 0),
    0
  );

  const weekStart = new Date(`${parsed.input.week_start_date}T00:00:00`);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndDate = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;

  const viewModel = {
    reportType: 'weekly',
    title: 'Weekly Report',
    subtitle: `Weekly report for ${parsed.input.site_name}`,
    siteName: parsed.input.site_name,
    reportDate: parsed.input.week_start_date,
    weekStartDate: parsed.input.week_start_date,
    weekEndDate,
    generatedAt: new Date().toISOString(),
    summaryCards: [
      { label: 'Total ON Hours of Week', value: totalOnHoursWeek.toFixed(1) },
      { label: 'Movies Poster Plays', value: totalMoviePosterPlaysWeek },
      { label: 'Elevate Plays', value: totalElevatePlaysWeek },
      { label: 'Ads Runs', value: totalAdsRunsWeek },
      { label: 'Total Runtime', value: formatReadableTime(totalRuntimeSecondsWeek) },
    ],
    tableVariant: 'weekly',
    tableRows: aggregatedRows,
    totalRuntimeSeconds: totalRuntimeSecondsWeek,
    totalRuntimeReadable: formatReadableTime(totalRuntimeSecondsWeek),
    printUrl: '',
  };

  const reportRecord = {
    report_type: 'weekly',
    site_name: parsed.input.site_name,
    report_date: parsed.input.week_start_date,
    week_start_date: parsed.input.week_start_date,
    total_on_hours: totalOnHoursWeek,
    total_movie_posters: totalMoviePosterPlaysWeek,
    seconds_per_movie_poster: 0,
    elevate_repeat_count: totalElevatePlaysWeek,
    seconds_per_elevate_play: 0,
    computed_summary_json: JSON.stringify({
      reportType: 'weekly',
      siteName: parsed.input.site_name,
      generatedAt: viewModel.generatedAt,
      weekStartDate: parsed.input.week_start_date,
      weekEndDate,
      totals: {
        totalOnHoursWeek,
        totalMoviePosterPlaysWeek,
        totalElevatePlaysWeek,
        totalAdsRunsWeek,
        totalRuntimeSecondsWeek,
      },
    }),
  };

  const itemRecords = [];
  parsed.dayResults.forEach((dayResult, dayIndex) => {
    dayResult.calculation.rows.forEach((row, rowIndex) => {
      itemRecords.push({
        day_key: dayResult.dayKey,
        item_type: row.item_type,
        item_name: row.item_name,
        duration_seconds: row.duration_seconds,
        plays_in_playlist: row.plays_in_playlist,
        plays_one_hour: row.plays_one_hour,
        plays_in_period: row.plays_in_period,
        total_screen_time_seconds: row.total_screen_time_seconds,
        readable_time: row.readable_time,
        sort_order: dayIndex * 100 + rowIndex,
      });
    });
  });

  return {
    errors: [],
    formData,
    viewModel,
    reportRecord,
    itemRecords,
  };
}

function buildStoredReportView(report, items) {
  if (!report) {
    return null;
  }

  if (report.report_type === 'weekly') {
    const dayBuckets = new Map();
    for (const row of items) {
      const key = [
        row.item_type,
        row.item_name,
        row.duration_seconds,
      ].join('|');

      if (!dayBuckets.has(key)) {
        dayBuckets.set(key, {
          item_type: row.item_type,
          item_name: row.item_name,
          duration_seconds: row.duration_seconds,
          plays_in_playlist: row.plays_in_playlist,
          total_plays_this_week: 0,
          total_screen_time_seconds: 0,
        });
      }

      const bucket = dayBuckets.get(key);
      bucket.total_plays_this_week += row.plays_in_period;
      bucket.total_screen_time_seconds += row.total_screen_time_seconds;
    }

    const summary = (() => {
      try {
        return JSON.parse(report.computed_summary_json || '{}');
      } catch (error) {
        return {};
      }
    })();

    const totalRuntimeSeconds = [...dayBuckets.values()].reduce(
      (sum, row) => sum + Number(row.total_screen_time_seconds || 0),
      0
    );

    return {
      reportType: 'weekly',
      title: 'Weekly Report',
      subtitle: `Weekly report for ${report.site_name}`,
      siteName: report.site_name,
      reportDate: report.report_date || '',
      weekStartDate: report.week_start_date || '',
      weekEndDate: summary.weekEndDate || '',
      generatedAt: report.created_at || '',
      summaryCards: [
        {
          label: 'Total ON Hours of Week',
          value: Number((summary?.totals?.totalOnHoursWeek ?? report.total_on_hours ?? 0)).toFixed(1),
        },
        {
          label: 'Movies Poster Plays',
          value: Number(summary?.totals?.totalMoviePosterPlaysWeek ?? report.total_movie_posters ?? 0),
        },
        {
          label: 'Elevate Plays',
          value: Number(summary?.totals?.totalElevatePlaysWeek ?? report.elevate_repeat_count ?? 0),
        },
        {
          label: 'Ads Runs',
          value: Number(summary?.totals?.totalAdsRunsWeek ?? 0),
        },
        {
          label: 'Total Runtime',
          value: formatReadableTime(totalRuntimeSeconds),
        },
      ],
      tableVariant: 'weekly',
      tableRows: [...dayBuckets.values()]
        .sort((left, right) => {
          const order = { movie: 0, elevate: 1, ad: 2 };
          const typeDelta = (order[left.item_type] ?? 99) - (order[right.item_type] ?? 99);
          if (typeDelta !== 0) {
            return typeDelta;
          }

          return left.item_name.localeCompare(right.item_name);
        })
        .map((row) => ({
          itemLabel: row.item_name,
          totalPlaysThisWeek: row.total_plays_this_week,
          avgPlaysPerDay: Number((row.total_plays_this_week / 7).toFixed(1)),
          totalWeeklyScreenTimeSeconds: row.total_screen_time_seconds,
          readableTime: formatReadableTime(row.total_screen_time_seconds),
        })),
      totalRuntimeSeconds,
      totalRuntimeReadable: formatReadableTime(totalRuntimeSeconds),
      printUrl: `/admin/vista-report/${report.id}/pdf`,
      detailUrl: `/admin/vista-report/weekly/${report.id}`,
    };
  }

  const tableRows = items.map((row) => ({
    itemLabel: row.item_name,
    playsOneHour: row.plays_one_hour,
    playsInPeriod: row.plays_in_period,
    totalScreenTimeSeconds: row.total_screen_time_seconds,
    readableTime: row.readable_time || formatReadableTime(row.total_screen_time_seconds),
  }));
  const totalRuntimeSeconds = tableRows.reduce((sum, row) => sum + Number(row.totalScreenTimeSeconds || 0), 0);
  const summary = (() => {
    try {
      return JSON.parse(report.computed_summary_json || '{}');
    } catch (error) {
      return {};
    }
  })();
  const summaryTotals = summary.totals || {};

  return {
    reportType: 'daily',
    title: 'Daily Report',
    subtitle: `Daily report for ${report.site_name}`,
    siteName: report.site_name,
    reportDate: report.report_date || '',
    weekStartDate: '',
    weekEndDate: '',
    generatedAt: report.created_at || '',
    summaryCards: [
      { label: 'Total Movies Poster', value: summaryTotals.totalMoviesPoster ?? report.total_movie_posters ?? 0 },
      {
        label: 'Ads Run',
        value: summaryTotals.adsRun ?? tableRows
          .filter((row) => row.itemLabel !== 'Movies Poster' && row.itemLabel !== 'Elevate')
          .reduce((sum, row) => sum + Number(row.playsInPeriod || 0), 0),
      },
      {
        label: 'Elevate (Special Ads)',
        value: summaryTotals.elevate ?? (tableRows.find((row) => row.itemLabel === 'Elevate')?.playsInPeriod || 0),
      },
      { label: 'ON Time (Hours)', value: Number(summaryTotals.onTimeHours ?? report.total_on_hours ?? 0).toFixed(1) },
    ],
    tableVariant: 'daily',
    tableRows,
    totalRuntimeSeconds,
    totalRuntimeReadable: formatReadableTime(totalRuntimeSeconds),
    printUrl: `/admin/vista-report/${report.id}/pdf`,
    detailUrl: `/admin/vista-report/daily/${report.id}`,
  };
}

function buildHistoryPageViewModel(reports, filters = {}) {
  return {
    filters: {
      reportType: filters.reportType || '',
      siteName: filters.siteName || '',
      reportDate: filters.reportDate || '',
    },
    reports: reports.map((report) => {
      const summary = (() => {
        try {
          return JSON.parse(report.computed_summary_json || '{}');
        } catch (error) {
          return {};
        }
      })();

      const isWeekly = report.report_type === 'weekly';
      return {
        id: report.id,
        reportType: report.report_type,
        siteName: report.site_name,
        dateLabel: isWeekly
          ? `${report.week_start_date || ''}${summary.weekEndDate ? ` to ${summary.weekEndDate}` : ''}`
          : report.report_date || '',
        createdAt: report.created_at,
        viewUrl: isWeekly ? `/admin/vista-report/weekly/${report.id}` : `/admin/vista-report/daily/${report.id}`,
        printUrl: `/admin/vista-report/${report.id}/pdf`,
        deleteUrl: `/admin/vista-report/${report.id}/delete`,
      };
    }),
  };
}

module.exports = {
  DAY_KEYS,
  DAY_LABELS,
  buildHistoryPageViewModel,
  buildStoredReportView,
  calculateDailyReportFromForm,
  calculateWeeklyReportFromForm,
  formatReadableTime,
};
