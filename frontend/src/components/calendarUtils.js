import dayjs from 'dayjs';

export const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
export const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

export const HEAT_COLORS = [
  '#e5e7eb',   // grey (0)
  '#86efac',   // green-300 (1)
  '#22c55e',   // green-500 (2)
  '#3b82f6',   // blue-500 (3-4)
  '#f97316',   // orange-500 (5-7)
  '#ef4444',   // red-500 (8+)
];

export function getHeatColor(count) {
  if (count === 0) return HEAT_COLORS[0];
  if (count === 1) return HEAT_COLORS[1];
  if (count === 2) return HEAT_COLORS[2];
  if (count <= 4) return HEAT_COLORS[3];
  if (count <= 7) return HEAT_COLORS[4];
  return HEAT_COLORS[5];
}

export function getMonthWeeks(year, month, countMap, today) {
  const firstDay = dayjs(`${year}-${String(month + 1).padStart(2, '0')}-01`);
  const daysInMonth = firstDay.daysInMonth();

  const weeks = [];
  let currentWeek = new Array(7).fill(null);

  for (let d = 1; d <= daysInMonth; d++) {
    const date = firstDay.date(d);
    const dateStr = date.format('YYYY-MM-DD');
    const dow = date.day();

    currentWeek[dow] = {
      date: dateStr,
      day: d,
      count: countMap[dateStr] || 0,
      isFuture: today ? date.isAfter(today, 'day') : false,
    };

    if (dow === 6 || d === daysInMonth) {
      weeks.push(currentWeek);
      currentWeek = new Array(7).fill(null);
    }
  }

  return weeks;
}

export function buildCountMap(data) {
  const map = {};
  (data || []).forEach(({ date, count }) => {
    map[dayjs(date).format('YYYY-MM-DD')] = Number(count);
  });
  return map;
}
