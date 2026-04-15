(function attachShowtimeUtils(root) {
  if (!root) {
    return;
  }

  function formatTodayString() {
    const now = new Date();
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    const day = String(now.getDate()).padStart(2, '0');
    const month = now.toLocaleDateString('en-US', { month: 'long' });
    const year = now.getFullYear();
    return `${weekday}, ${day} ${month} ${year}`;
  }

  function parseDateLabel(dateLabel) {
    if (dateLabel instanceof Date && !Number.isNaN(dateLabel.getTime())) {
      return new Date(dateLabel.getFullYear(), dateLabel.getMonth(), dateLabel.getDate());
    }

    const text = String(dateLabel || '').trim();
    if (!text) {
      return null;
    }

    const directParse = new Date(text);
    if (!Number.isNaN(directParse.getTime())) {
      return new Date(directParse.getFullYear(), directParse.getMonth(), directParse.getDate());
    }

    const monthMap = {
      january: 0,
      february: 1,
      march: 2,
      april: 3,
      may: 4,
      june: 5,
      july: 6,
      august: 7,
      september: 8,
      october: 9,
      november: 10,
      december: 11,
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      sept: 8,
      oct: 9,
      nov: 10,
      dec: 11,
    };

    const longMonthMatch = text.match(/^(?:[A-Za-z]+,\s*)?(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (longMonthMatch) {
      const day = Number(longMonthMatch[1]);
      const monthIndex = monthMap[String(longMonthMatch[2]).toLowerCase()];
      const year = Number(longMonthMatch[3]);

      if (Number.isInteger(day) && Number.isInteger(year) && monthIndex !== undefined) {
        return new Date(year, monthIndex, day);
      }
    }

    const numericMatch = text.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/);
    if (numericMatch) {
      const first = Number(numericMatch[1]);
      const second = Number(numericMatch[2]);
      const third = Number(numericMatch[3]);

      if (String(numericMatch[1]).length === 4) {
        return new Date(first, second - 1, third);
      }

      if (String(numericMatch[3]).length === 4) {
        return new Date(third, second - 1, first);
      }
    }

    return null;
  }

  function parseTimeLabel(timeLabel) {
    const text = String(timeLabel || '').trim();
    if (!text) {
      return null;
    }

    const twelveHourMatch = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (twelveHourMatch) {
      let hours = Number(twelveHourMatch[1]);
      const minutes = Number(twelveHourMatch[2]);
      const meridiem = twelveHourMatch[3].toUpperCase();

      if (meridiem === 'PM' && hours !== 12) {
        hours += 12;
      }

      if (meridiem === 'AM' && hours === 12) {
        hours = 0;
      }

      return { hours, minutes };
    }

    const twentyFourHourMatch = text.match(/^(\d{1,2}):(\d{2})$/);
    if (twentyFourHourMatch) {
      return {
        hours: Number(twentyFourHourMatch[1]),
        minutes: Number(twentyFourHourMatch[2]),
      };
    }

    return null;
  }

  function buildLocalDateTime(dateLabel, timeLabel) {
    const showDate = parseDateLabel(dateLabel);
    const showTime = parseTimeLabel(timeLabel);

    if (!showDate || !showTime) {
      return null;
    }

    return new Date(
      showDate.getFullYear(),
      showDate.getMonth(),
      showDate.getDate(),
      showTime.hours,
      showTime.minutes,
      0,
      0
    );
  }

  function filterTodayShowtimes(showtimesByDate, now = new Date()) {
    const todayLabel = formatTodayString();
    const todayEntry = (Array.isArray(showtimesByDate) ? showtimesByDate : []).find((entry) => entry?.date === todayLabel);
    if (!todayEntry) {
      return [];
    }

    const times = (Array.isArray(todayEntry?.times) ? todayEntry.times : [])
      .filter(Boolean)
      .filter((time) => {
        const showDateTime = buildLocalDateTime(todayEntry.date, time);
        return showDateTime ? showDateTime.getTime() > now.getTime() : false;
      });

    if (times.length === 0) {
      return [];
    }

    return [{
      ...todayEntry,
      times,
    }];
  }

  root.ShowtimeUtils = Object.freeze({
    formatTodayString,
    parseDateLabel,
    parseTimeLabel,
    buildLocalDateTime,
    filterTodayShowtimes,
  });
})(window);
