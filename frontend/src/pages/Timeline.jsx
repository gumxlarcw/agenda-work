import { useState, useEffect, useMemo, useRef } from 'react';
import {
  HiOutlineChevronLeft, HiOutlineChevronRight, HiOutlinePlus,
  HiOutlineFilter, HiOutlineCalendar, HiOutlineX,
} from 'react-icons/hi';
import dayjs from 'dayjs';
import { eventsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { DAY_LABELS, MONTH_NAMES, getMonthWeeks } from '../components/calendarUtils';
import EventModal from '../components/EventModal';

/* ═══════════════════════════════════════════════
   Constants & helpers
   ═══════════════════════════════════════════════ */
const MAX_DAY_ITER = 3650;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export default function Timeline() {
  const { user } = useAuth();
  const [year, setYear] = useState(dayjs().year());
  const [selectedMonth, setSelectedMonth] = useState(dayjs().month());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eventModalDate, setEventModalDate] = useState(null);
  const [showAllEvents, setShowAllEvents] = useState(true);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [catFilterOpen, setCatFilterOpen] = useState(false);
  const catFilterRef = useRef(null);
  const monthDetailRef = useRef(null);

  /* ─── Data fetch ────────────────────────── */
  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await eventsAPI.getAll({ year });
      setEvents(res.data.data || []);
    } catch (err) {
      console.error('Timeline fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [year]);

  // Close category dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (catFilterRef.current && !catFilterRef.current.contains(e.target)) setCatFilterOpen(false);
    };
    if (catFilterOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [catFilterOpen]);

  const today = dayjs();

  /* ─── Category options ──────────────────── */
  const categoryOptions = useMemo(() => {
    const cats = new Set();
    events.forEach(e => { if (e.category) cats.add(e.category); });
    return [...cats].sort();
  }, [events]);

  /* ─── Filtered events ───────────────────── */
  const filteredEvents = useMemo(() => {
    let result = events;
    if (!showAllEvents) result = result.filter(e => e.user_id === user?.id);
    if (selectedCategories.length > 0) result = result.filter(e => selectedCategories.includes(e.category));
    return result;
  }, [events, showAllEvents, user, selectedCategories]);

  /* ─── Event maps ────────────────────────── */
  const eventCountMap = useMemo(() => {
    const map = {};
    filteredEvents.forEach(ev => {
      let d = dayjs(ev.start_date);
      const end = dayjs(ev.end_date);
      let i = 0;
      while ((d.isBefore(end, 'day') || d.isSame(end, 'day')) && i++ < MAX_DAY_ITER) {
        const key = d.format('YYYY-MM-DD');
        map[key] = (map[key] || 0) + 1;
        d = d.add(1, 'day');
      }
    });
    return map;
  }, [filteredEvents]);

  const eventsMap = useMemo(() => {
    const map = {};
    filteredEvents.forEach(ev => {
      let d = dayjs(ev.start_date);
      const end = dayjs(ev.end_date);
      let i = 0;
      while ((d.isBefore(end, 'day') || d.isSame(end, 'day')) && i++ < MAX_DAY_ITER) {
        const key = d.format('YYYY-MM-DD');
        if (!map[key]) map[key] = [];
        map[key].push(ev);
        d = d.add(1, 'day');
      }
    });
    return map;
  }, [filteredEvents]);

  /* ─── Summary stats (inline) ────────────── */
  const summaryStats = useMemo(() => {
    const monthStart = dayjs(`${year}-${String(selectedMonth + 1).padStart(2, '0')}-01`);
    const monthEnd = monthStart.endOf('month');
    const weekStart = today.startOf('week');
    const weekEnd = today.endOf('week');

    let monthCount = 0;
    let weekCount = 0;
    let upcomingCount = 0;

    filteredEvents.forEach(ev => {
      const eStart = dayjs(ev.start_date);
      const eEnd = dayjs(ev.end_date);
      // Month overlap
      if (!(eEnd.isBefore(monthStart, 'day') || eStart.isAfter(monthEnd, 'day'))) monthCount++;
      // Week overlap
      if (!(eEnd.isBefore(weekStart, 'day') || eStart.isAfter(weekEnd, 'day'))) weekCount++;
      // Upcoming (starts in future)
      if (eStart.isAfter(today, 'day')) upcomingCount++;
    });
    return { total: filteredEvents.length, month: monthCount, week: weekCount, upcoming: upcomingCount };
  }, [filteredEvents, year, selectedMonth, today]);

  /* ─── Legend ────────────────────────────── */
  const legendItems = useMemo(() => {
    const seen = new Set();
    const items = [];
    filteredEvents.forEach(e => {
      const c = e.color || '#6366f1';
      const cat = e.category || '';
      if (!cat) return;
      const key = `${c}|${cat}`;
      if (!seen.has(key)) { seen.add(key); items.push({ color: c, label: cat }); }
    });
    return items;
  }, [filteredEvents]);

  const monthLegendItems = useMemo(() => {
    const seen = new Set();
    const items = [];
    const monthStart = dayjs(`${year}-${String(selectedMonth + 1).padStart(2, '0')}-01`);
    const monthEnd = monthStart.endOf('month');
    filteredEvents.forEach(e => {
      const eStart = dayjs(e.start_date);
      const eEnd = dayjs(e.end_date);
      if (eEnd.isBefore(monthStart, 'day') || eStart.isAfter(monthEnd, 'day')) return;
      const c = e.color || '#6366f1';
      const cat = e.category || '';
      if (!cat) return;
      const key = `${c}|${cat}`;
      if (!seen.has(key)) { seen.add(key); items.push({ color: c, label: cat }); }
    });
    return items;
  }, [filteredEvents, year, selectedMonth]);

  /* ─── Calendar grids ────────────────────── */
  const yearlyMonths = useMemo(() => {
    return Array.from({ length: 12 }, (_, m) => ({
      month: m,
      label: MONTH_NAMES[m],
      shortLabel: SHORT_MONTHS[m],
      weeks: getMonthWeeks(year, m, eventCountMap, today),
    }));
  }, [year, eventCountMap]);

  const detailWeeks = useMemo(() => {
    return getMonthWeeks(year, selectedMonth, eventCountMap, today);
  }, [year, selectedMonth, eventCountMap]);

  /* ─── Month events for agenda list (mobile) ─── */
  const monthAgenda = useMemo(() => {
    const monthStart = dayjs(`${year}-${String(selectedMonth + 1).padStart(2, '0')}-01`);
    const monthEnd = monthStart.endOf('month');
    return filteredEvents
      .filter(ev => {
        const eStart = dayjs(ev.start_date);
        const eEnd = dayjs(ev.end_date);
        return !(eEnd.isBefore(monthStart, 'day') || eStart.isAfter(monthEnd, 'day'));
      })
      .sort((a, b) => dayjs(a.start_date).diff(dayjs(b.start_date)));
  }, [filteredEvents, year, selectedMonth]);

  /* ─── Handlers ──────────────────────────── */
  const handleMonthClick = (monthIdx) => {
    setSelectedMonth(monthIdx);
    monthDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleModalSaved = () => { setEventModalDate(null); fetchData(); };

  const prevMonth = () => {
    if (selectedMonth === 0) { setYear(y => y - 1); setSelectedMonth(11); }
    else setSelectedMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (selectedMonth === 11) { setYear(y => y + 1); setSelectedMonth(0); }
    else setSelectedMonth(m => m + 1);
  };

  /* ─── Loading state ─────────────────────── */
  if (loading) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="h-16 bg-white rounded-2xl animate-pulse" />
        <div className="h-64 bg-white rounded-2xl animate-pulse" />
        <div className="h-80 bg-white rounded-2xl animate-pulse" />
      </div>
    );
  }

  /* ─── Desktop event cell for detail calendar ─── */
  const renderEventCell = (cell, di) => {
    if (!cell) return <div key={di} className="min-h-[90px]" />;
    const isToday = cell.date === today.format('YYYY-MM-DD');
    const dayEvts = eventsMap[cell.date] || [];
    const isPast = dayjs(cell.date).isBefore(today, 'day');

    return (
      <div
        key={di}
        onClick={() => setEventModalDate(cell.date)}
        className={`min-h-[90px] rounded-xl p-1.5 cursor-pointer transition-all border group
          ${isToday
            ? 'ring-2 ring-primary-500 border-primary-200 bg-primary-50/30'
            : dayEvts.length > 0
              ? 'border-gray-100 hover:border-primary-200 hover:shadow-sm bg-white'
              : isPast
                ? 'border-gray-50 bg-gray-50/30'
                : 'border-gray-100 hover:border-gray-200 bg-white'
          }`}
      >
        <div className="flex items-center justify-between mb-1">
          <span className={`text-xs font-bold leading-none ${
            isToday ? 'bg-primary-600 text-white w-6 h-6 rounded-full flex items-center justify-center' : isPast ? 'text-gray-300' : 'text-gray-600'
          }`}>
            {cell.day}
          </span>
          {dayEvts.length > 0 && (
            <span className="text-[9px] font-semibold text-primary-500 bg-primary-50 px-1.5 py-0.5 rounded-full">
              {dayEvts.length}
            </span>
          )}
        </div>
        <div className="space-y-0.5 overflow-hidden">
          {dayEvts.slice(0, 3).map(ev => (
            <div key={ev.id}
              className="text-[10px] leading-tight px-1.5 py-0.5 rounded-md break-words font-medium"
              style={{ backgroundColor: `${ev.color || '#6366f1'}18`, color: ev.color || '#6366f1' }}
            >
              {ev.title}
            </div>
          ))}
          {dayEvts.length > 3 && (
            <div className="text-[9px] text-gray-400 px-1.5 font-medium">+{dayEvts.length - 3} lainnya</div>
          )}
        </div>
      </div>
    );
  };

  /* ═══════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════ */
  return (
    <div className="space-y-5 animate-fadeIn">

      {/* ══════ Header + Inline Summary ══════ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-200">
            <HiOutlineCalendar className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Timeline</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {summaryStats.total} event total · {summaryStats.month} bulan ini · {summaryStats.week} minggu ini
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setYear(y => y - 1)}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <HiOutlineChevronLeft className="w-5 h-5 text-gray-500" />
          </button>
          <button
            onClick={() => { setYear(dayjs().year()); setSelectedMonth(dayjs().month()); }}
            className="px-4 py-2 text-sm font-semibold bg-primary-50 text-primary-600 rounded-xl hover:bg-primary-100 transition-colors min-w-[80px] text-center"
          >
            {year === dayjs().year() ? 'Today' : year}
          </button>
          <button onClick={() => setYear(y => y + 1)}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <HiOutlineChevronRight className="w-5 h-5 text-gray-500" />
          </button>
        </div>
      </div>

      {/* ══════ 12-Month Overview Grid ══════ */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Controls bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            {/* User toggle */}
            <button
              onClick={() => setShowAllEvents(v => !v)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all ${
                showAllEvents
                  ? 'bg-primary-50 border-primary-200 text-primary-700'
                  : 'bg-amber-50 border-amber-200 text-amber-700'
              }`}
            >
              <span className={`inline-block w-7 h-3.5 rounded-full relative transition-colors ${
                showAllEvents ? 'bg-primary-500' : 'bg-amber-400'
              }`}>
                <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${
                  showAllEvents ? 'left-[14px]' : 'left-0.5'
                }`} />
              </span>
              {showAllEvents ? 'Semua' : 'Milik Saya'}
            </button>

            {/* Category filter */}
            {categoryOptions.length > 0 && (
              <div className="relative" ref={catFilterRef}>
                <button
                  onClick={() => setCatFilterOpen(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all ${
                    selectedCategories.length > 0
                      ? 'bg-primary-50 border-primary-200 text-primary-700'
                      : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <HiOutlineFilter className="w-3.5 h-3.5" />
                  Kategori
                  {selectedCategories.length > 0 && (
                    <span className="bg-primary-600 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                      {selectedCategories.length}
                    </span>
                  )}
                </button>
                {catFilterOpen && (
                  <div className="absolute left-0 top-full mt-1.5 z-40 bg-white border border-gray-200 rounded-xl shadow-xl min-w-[200px] py-1 animate-fadeIn">
                    {categoryOptions.map(cat => {
                      const checked = selectedCategories.includes(cat);
                      return (
                        <label key={cat}
                          className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm text-gray-700">
                          <input type="checkbox" checked={checked}
                            onChange={() => setSelectedCategories(prev =>
                              checked ? prev.filter(c => c !== cat) : [...prev, cat]
                            )}
                            className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                          {cat}
                        </label>
                      );
                    })}
                    {selectedCategories.length > 0 && (
                      <div className="border-t mt-1 pt-1 px-3 py-1.5">
                        <button onClick={() => setSelectedCategories([])}
                          className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                          Reset filter
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => {
              const firstOfMonth = dayjs(`${year}-${String(selectedMonth + 1).padStart(2, '0')}-01`).format('YYYY-MM-DD');
              setEventModalDate(firstOfMonth);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white text-xs font-semibold rounded-xl hover:bg-primary-700 transition-colors shadow-sm shadow-primary-200"
          >
            <HiOutlinePlus className="w-3.5 h-3.5" />
            Add Event
          </button>
        </div>

        {/* Mini calendar grid */}
        <div className="p-4">
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {yearlyMonths.map(({ month, shortLabel, weeks }) => {
              const isCurrent = year === today.year() && month === today.month();
              const isSelected = month === selectedMonth;
              // Count events this month
              const monthStart = dayjs(`${year}-${String(month + 1).padStart(2, '0')}-01`);
              const monthEnd = monthStart.endOf('month');
              const monthEvtCount = filteredEvents.filter(ev => {
                const s = dayjs(ev.start_date);
                const e = dayjs(ev.end_date);
                return !(e.isBefore(monthStart, 'day') || s.isAfter(monthEnd, 'day'));
              }).length;

              return (
                <div
                  key={month}
                  onClick={() => handleMonthClick(month)}
                  className={`cursor-pointer rounded-xl p-2.5 transition-all border-2 ${
                    isSelected
                      ? 'border-primary-500 bg-primary-50/50 shadow-sm shadow-primary-100'
                      : isCurrent
                        ? 'border-primary-200 bg-primary-50/20'
                        : 'border-transparent hover:bg-gray-50 hover:border-gray-100'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <p className={`text-xs font-bold ${isSelected ? 'text-primary-700' : 'text-gray-700'}`}>
                      {shortLabel}
                    </p>
                    {monthEvtCount > 0 && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        isSelected ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {monthEvtCount}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-7 gap-[2px] mb-[2px]">
                    {DAY_LABELS.map(d => (
                      <div key={d} className="text-center text-[6px] text-gray-400 font-medium leading-none">{d[0]}</div>
                    ))}
                  </div>
                  {weeks.map((week, wi) => (
                    <div key={wi} className="grid grid-cols-7 gap-[2px] mb-[2px]">
                      {week.map((cell, di) => {
                        if (!cell) return <div key={di} className="aspect-square" />;
                        const isTodayCell = cell.date === today.format('YYYY-MM-DD');
                        const dayEvts = eventsMap[cell.date] || [];
                        const uniqueColors = dayEvts.length > 0
                          ? [...new Set(dayEvts.map(e => e.color || '#6366f1'))]
                          : [];

                        if (uniqueColors.length > 1) {
                          return (
                            <div key={di}
                              className={`aspect-square rounded-[3px] flex overflow-hidden relative ${isTodayCell ? 'ring-1 ring-primary-500' : ''}`}>
                              {uniqueColors.map((c, ci) => (
                                <div key={ci} className="h-full" style={{ backgroundColor: c, width: `${100 / uniqueColors.length}%` }} />
                              ))}
                              <span className="absolute inset-0 flex items-center justify-center text-[7px] leading-none font-medium text-white">
                                {cell.day}
                              </span>
                            </div>
                          );
                        }

                        const bg = uniqueColors.length > 0
                          ? uniqueColors[0]
                          : (cell.isFuture ? '#f9fafb' : '#e5e7eb');
                        const numColor = cell.isFuture ? '#d1d5db'
                          : (dayEvts.length >= 2 ? '#fff' : '#374151');

                        return (
                          <div key={di}
                            className={`aspect-square rounded-[3px] flex items-center justify-center text-[7px] leading-none ${isTodayCell ? 'ring-1 ring-primary-500' : ''}`}
                            style={{ backgroundColor: bg, opacity: dayEvts.length > 0 ? 0.75 : 1, color: numColor }}>
                            {cell.day}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          {legendItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mt-4 pt-3 border-t border-gray-100">
              <span className="font-semibold text-gray-600 text-[10px] uppercase tracking-wider">Events:</span>
              {legendItems.map((item, i) => (
                <div key={`${item.color}-${i}`} className="flex items-center gap-1">
                  <span className="inline-block rounded-sm flex-shrink-0" style={{ width: 10, height: 10, backgroundColor: item.color }} />
                  <span className="text-[11px]">{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ══════ Monthly Detail Calendar ══════ */}
      <div ref={monthDetailRef} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Month nav header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <button onClick={prevMonth} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <HiOutlineChevronLeft className="w-5 h-5 text-gray-400" />
          </button>
          <div className="text-center">
            <h2 className="text-lg font-bold text-gray-900">
              {MONTH_NAMES[selectedMonth]} {year}
            </h2>
            {monthAgenda.length > 0 && (
              <p className="text-[11px] text-gray-400 mt-0.5">{monthAgenda.length} event</p>
            )}
          </div>
          <button onClick={nextMonth} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <HiOutlineChevronRight className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Desktop: Full calendar grid */}
        <div className="hidden md:block p-4">
          <div className="grid grid-cols-7 gap-1.5 mb-1">
            {DAY_LABELS.map(d => (
              <div key={d} className="text-center text-[11px] font-bold text-gray-400 uppercase tracking-wider py-2">{d}</div>
            ))}
          </div>
          {detailWeeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1.5 mb-1.5">
              {week.map((cell, di) => renderEventCell(cell, di))}
            </div>
          ))}
        </div>

        {/* Mobile: Compact calendar + agenda list */}
        <div className="block md:hidden p-3">
          {/* Mini calendar */}
          <div className="grid grid-cols-7 gap-[3px] mb-1">
            {DAY_LABELS.map(d => (
              <div key={d} className="text-center text-[9px] font-bold text-gray-400 uppercase py-1">{d[0]}</div>
            ))}
          </div>
          {detailWeeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-[3px] mb-[3px]">
              {week.map((cell, di) => {
                if (!cell) return <div key={di} className="aspect-square" />;
                const isToday = cell.date === today.format('YYYY-MM-DD');
                const dayEvts = eventsMap[cell.date] || [];
                const hasEvts = dayEvts.length > 0;
                return (
                  <div key={di}
                    onClick={() => setEventModalDate(cell.date)}
                    className={`aspect-square rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all
                      ${isToday ? 'bg-primary-600 text-white shadow-sm' : hasEvts ? 'bg-primary-50' : 'bg-gray-50'}
                    `}>
                    <span className={`text-[10px] font-semibold leading-none ${isToday ? '' : hasEvts ? 'text-primary-700' : 'text-gray-500'}`}>
                      {cell.day}
                    </span>
                    {hasEvts && !isToday && (
                      <div className="flex gap-[2px] mt-0.5">
                        {dayEvts.slice(0, 3).map((ev, ei) => (
                          <span key={ei} className="w-[4px] h-[4px] rounded-full" style={{ backgroundColor: ev.color || '#6366f1' }} />
                        ))}
                      </div>
                    )}
                    {hasEvts && isToday && (
                      <span className="text-[8px] font-bold mt-0.5">{dayEvts.length}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Agenda list for mobile */}
          {monthAgenda.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Agenda Bulan Ini</p>
              {monthAgenda.map(ev => {
                const s = dayjs(ev.start_date);
                const e = ev.end_date ? dayjs(ev.end_date) : s;
                const isPast = e.isBefore(today, 'day');
                const isOngoing = !isPast && (s.isBefore(today, 'day') || s.isSame(today, 'day'));
                return (
                  <div key={ev.id}
                    onClick={() => setEventModalDate(s.format('YYYY-MM-DD'))}
                    className={`flex items-start gap-2.5 px-3 py-2 rounded-xl cursor-pointer transition-colors hover:bg-gray-50 ${isPast ? 'opacity-40' : ''}`}>
                    <div className="w-1.5 rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: ev.color || '#6366f1', minHeight: '24px' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 break-words">{ev.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-gray-400">
                          {s.format('D MMM')}{!s.isSame(e, 'day') ? ` → ${e.format('D MMM')}` : ''}
                        </span>
                        {ev.category && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                            style={{ backgroundColor: `${ev.color || '#6366f1'}15`, color: ev.color || '#6366f1' }}>
                            {ev.category}
                          </span>
                        )}
                        {isOngoing && (
                          <span className="text-[9px] font-semibold text-primary-600 bg-primary-50 px-1 py-px rounded">Berlangsung</span>
                        )}
                      </div>
                    </div>
                    {ev.creator_username && (
                      <span className="text-[10px] text-gray-300 flex-shrink-0 self-center">
                        {(ev.creator_name || ev.creator_username).charAt(0)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {monthAgenda.length === 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 text-center py-6">
              <HiOutlineCalendar className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-xs text-gray-400">Tidak ada event bulan ini</p>
            </div>
          )}
        </div>

        {/* Month legend (desktop) */}
        {monthLegendItems.length > 0 && (
          <div className="hidden md:flex items-center gap-2 flex-wrap text-xs text-gray-500 px-5 py-3 border-t border-gray-100">
            <span className="font-semibold text-gray-600 text-[10px] uppercase tracking-wider">Events:</span>
            {monthLegendItems.map((item, i) => (
              <div key={`${item.color}-${i}`} className="flex items-center gap-1">
                <span className="inline-block rounded-sm flex-shrink-0" style={{ width: 10, height: 10, backgroundColor: item.color }} />
                <span className="text-[11px]">{item.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══════ Event Modal ══════ */}
      {eventModalDate && (
        <EventModal
          date={eventModalDate}
          eventList={events}
          onClose={() => setEventModalDate(null)}
          onSaved={handleModalSaved}
        />
      )}
    </div>
  );
}
