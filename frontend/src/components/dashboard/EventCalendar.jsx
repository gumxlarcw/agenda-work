import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import dayjs from 'dayjs';
import { HiOutlineChevronLeft, HiOutlineChevronRight, HiOutlineCalendar } from 'react-icons/hi';
import { glassCard } from './BentoGrid';

const DAY_LABELS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

function buildCalendarGrid(year, month) {
  const firstDay = dayjs(`${year}-${String(month + 1).padStart(2, '0')}-01`);
  const daysInMonth = firstDay.daysInMonth();
  let startDow = firstDay.day() - 1;
  if (startDow < 0) startDow = 6;

  const weeks = [];
  let week = new Array(startDow).fill(null);

  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

function mapEventsToDays(events, year, month) {
  const map = {};
  const monthStart = dayjs(`${year}-${String(month + 1).padStart(2, '0')}-01`);
  const monthEnd = monthStart.endOf('month');

  for (const ev of events) {
    const evStart = dayjs(ev.start_date);
    const evEnd = ev.end_date ? dayjs(ev.end_date) : evStart;
    const rangeStart = evStart.isBefore(monthStart) ? monthStart : evStart;
    const rangeEnd = evEnd.isAfter(monthEnd) ? monthEnd : evEnd;

    let cursor = rangeStart;
    while (cursor.isBefore(rangeEnd) || cursor.isSame(rangeEnd, 'day')) {
      const d = cursor.date();
      if (!map[d]) map[d] = [];
      map[d].push({
        id: ev.id,
        title: ev.title,
        color: ev.color || '#6366f1',
        category: ev.category,
      });
      cursor = cursor.add(1, 'day');
    }
  }
  return map;
}

function buildLegend(events) {
  const cats = new Map();
  for (const ev of events) {
    const key = ev.category || 'Lainnya';
    if (!cats.has(key)) cats.set(key, ev.color || '#6366f1');
  }
  return Array.from(cats.entries()).map(([name, color]) => ({ name, color }));
}

function formatDateRange(ev) {
  const s = dayjs(ev.start_date);
  const e = ev.end_date ? dayjs(ev.end_date) : null;
  if (!e || s.isSame(e, 'day')) return s.format('D MMM');
  if (s.month() === e.month()) return `${s.format('D')}–${e.format('D MMM')}`;
  return `${s.format('D MMM')}–${e.format('D MMM')}`;
}

export default function EventCalendar({ events = [], loading, error, onRetry, onMonthChange }) {
  const [currentDate, setCurrentDate] = useState(dayjs());
  const [tooltip, setTooltip] = useState(null);

  const year = currentDate.year();
  const month = currentDate.month();

  const weeks = useMemo(() => buildCalendarGrid(year, month), [year, month]);
  const eventMap = useMemo(() => mapEventsToDays(events, year, month), [events, year, month]);
  const legend = useMemo(() => buildLegend(events), [events]);

  const sortedEvents = useMemo(() =>
    [...events].sort((a, b) => dayjs(a.start_date).diff(dayjs(b.start_date))),
    [events]
  );

  const navigate = (dir) => {
    const next = dir === 'prev' ? currentDate.subtract(1, 'month') : currentDate.add(1, 'month');
    setCurrentDate(next);
    onMonthChange?.(next.year(), next.month() + 1);
  };

  const today = dayjs();
  const isToday = (d) => d && today.year() === year && today.month() === month && today.date() === d;

  if (loading) {
    return (
      <div className={`${glassCard} p-5 animate-pulse h-full overflow-hidden`}>
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="h-8 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${glassCard} p-5 text-center text-gray-400 text-sm h-full overflow-hidden`}>
        Gagal memuat kalender. <button onClick={onRetry} className="text-indigo-500 underline no-drag">Retry</button>
      </div>
    );
  }

  return (
    <div className={`${glassCard} p-4 flex flex-col h-full overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <HiOutlineCalendar className="w-4 h-4 text-primary-500" />
          Timeline
        </h3>
        <div className="flex items-center gap-1 no-drag">
          <button onClick={() => navigate('prev')} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <HiOutlineChevronLeft className="w-4 h-4 text-gray-500" />
          </button>
          <span className="text-xs font-medium text-gray-700 min-w-[100px] text-center">
            {currentDate.format('MMMM YYYY')}
          </span>
          <button onClick={() => navigate('next')} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <HiOutlineChevronRight className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      </div>

      {/* Legend */}
      {legend.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 flex-shrink-0">
          {legend.map(({ name, color }) => (
            <div key={name} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-[10px] text-gray-500 leading-none">{name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Day labels */}
      <div className="grid grid-cols-7 gap-1 mb-1 flex-shrink-0">
        {DAY_LABELS.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-gray-400 uppercase">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-shrink-0">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-[2px] mb-[2px]">
            {week.map((day, di) => {
              const dayEvents = day ? (eventMap[day] || []) : [];
              const hasEvents = dayEvents.length > 0;
              return (
                <div
                  key={di}
                  className={`relative rounded-md p-0.5 min-h-[26px] flex flex-col items-center justify-center transition-colors
                    ${!day ? '' : isToday(day) ? 'bg-indigo-50 ring-1 ring-indigo-300' : hasEvents ? 'hover:bg-gray-50' : ''}
                  `}
                  onMouseEnter={(e) => {
                    if (!hasEvents) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    setTooltip({
                      x: rect.left + rect.width / 2,
                      y: rect.top - 4,
                      items: dayEvents,
                      day,
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {day && (
                    <>
                      <span className={`text-[11px] leading-none font-medium ${
                        isToday(day) ? 'text-indigo-600 font-bold' : 'text-gray-600'
                      }`}>{day}</span>
                      {hasEvents && (
                        <div className="flex gap-[2px] mt-0.5 flex-wrap justify-center">
                          {dayEvents.slice(0, 3).map((ev, ei) => (
                            <span
                              key={ei}
                              className="w-[5px] h-[5px] rounded-full"
                              style={{ backgroundColor: ev.color }}
                            />
                          ))}
                          {dayEvents.length > 3 && (
                            <span className="text-[8px] text-gray-400 leading-none">+{dayEvents.length - 3}</span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Timeline detail list */}
      {sortedEvents.length > 0 ? (
        <div className="mt-2 pt-2 border-t border-gray-100 flex-1 overflow-auto min-h-0">
          <div className="space-y-1">
            {sortedEvents.map(ev => {
              const s = dayjs(ev.start_date);
              const e = ev.end_date ? dayjs(ev.end_date) : s;
              const totalDays = e.diff(s, 'day') + 1;
              const isPast = e.isBefore(today, 'day');
              const isOngoing = !isPast && (s.isBefore(today, 'day') || s.isSame(today, 'day'));

              return (
                <div
                  key={ev.id}
                  className={`flex items-start gap-2 px-2 py-1.5 rounded-lg transition-colors ${
                    isPast ? 'opacity-40' : 'hover:bg-white/60'
                  }`}
                >
                  <div
                    className="w-1 rounded-full flex-shrink-0"
                    style={{ backgroundColor: ev.color || '#6366f1', minHeight: '28px' }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800 leading-tight break-words">{ev.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-gray-400">{formatDateRange(ev)}</span>
                      {totalDays > 1 && (
                        <span className="text-[10px] text-gray-300">({totalDays}d)</span>
                      )}
                      {isOngoing && (
                        <span className="text-[9px] font-semibold text-primary-600 bg-primary-50 px-1 py-px rounded">Berlangsung</span>
                      )}
                    </div>
                  </div>
                  {ev.category && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 self-center whitespace-nowrap"
                      style={{
                        backgroundColor: `${ev.color || '#6366f1'}18`,
                        color: ev.color || '#6366f1',
                      }}
                    >
                      {ev.category}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-2 pt-2 border-t border-gray-100 text-center flex-shrink-0">
          <p className="text-xs text-gray-400">Tidak ada event bulan ini</p>
        </div>
      )}

      {/* Tooltip — rendered via portal so it escapes the react-grid-layout
          transformed ancestor; otherwise `position: fixed` is relative to
          that transform and ends up offset from the actual cell. */}
      {tooltip && createPortal(
        <div
          className="fixed z-[9999] px-3 py-2 text-xs bg-gray-800 text-white rounded-lg shadow-lg pointer-events-none max-w-[280px]"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <p className="font-semibold mb-1">{tooltip.day} {currentDate.format('MMM YYYY')}</p>
          {tooltip.items.map((ev, i) => (
            <div key={i} className="flex items-center gap-1.5 py-0.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: ev.color }} />
              <span className="break-words">{ev.title}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
