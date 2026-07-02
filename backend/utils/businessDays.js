function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  return String(value).split('T')[0];
}

function subtractBusinessDays(dateStr, businessDays) {
  const date = new Date(`${normalizeDate(dateStr)}T12:00:00`);
  let remaining = businessDays;

  while (remaining > 0) {
    date.setDate(date.getDate() - 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }

  return date.toISOString().split('T')[0];
}

module.exports = { subtractBusinessDays, normalizeDate };
