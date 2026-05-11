import { useState, useMemo, useRef, useEffect } from 'react';
import dayjs from 'dayjs';
import { HiOutlineChevronLeft, HiOutlineChevronRight, HiOutlineCalendar } from 'react-icons/hi';
import { DAY_LABELS, MONTH_NAMES, HEAT_COLORS, getHeatColor, getMonthWeeks, buildCountMap } from './calendarUtils';

export default function DateRangePicker({ startDate, endDate, onChange, heatmapData = [] }) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => {
    if (startDate) return dayjs(startDate);
    return dayjs();
  });
  // selection phase: null = nothing picked yet, 'start' = picked start awaiting end
  const [pickPhase, setPickPhase] = useState(null);
  const [tempStart, setTempStart] = useState(null);
  const [hoverDate, setHoverDate] = useState(null);
  const ref = useRef(null);

  const countMap = useMemo(() => buildCountMap(heatmapData), [heatmapData]);

  const weeks = useMemo(() => {
    return getMonthWeeks(viewDate.year(), viewDate.month(), countMap, null);
  }, [viewDate, countMap]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setPickPhase(null);
        setTempStart(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const prevMonth = () => setViewDate(v => v.subtract(1, 'month'));
  const nextMonth = () => setViewDate(v => v.add(1, 'month'));

  const handleDayClick = (dateStr) => {
    if (pickPhase === null || pickPhase === 'done') {
      // First click: set start
      setTempStart(dateStr);
      setPickPhase('start');
    } else if (pickPhase === 'start') {
      // Second click: set end
      let s = tempStart;
      let e = dateStr;
      if (s > e) [s, e] = [e, s]; // swap if end < start
      onChange(s, e);
      setPickPhase('done');
      setTempStart(null);
      setOpen(false);
    }
  };

  const isInRange = (dateStr) => {
    if (pickPhase === 'start' && tempStart) {
      // Show preview range while hovering
      const hover = hoverDate || tempStart;
      const a = tempStart < hover ? tempStart : hover;
      const b = tempStart < hover ? hover : tempStart;
      return dateStr >= a && dateStr <= b;
    }
    if (startDate && endDate) {
      return dateStr >= startDate && dateStr <= endDate;
    }
    return false;
  };

  const isStart = (dateStr) => {
    if (pickPhase === 'start') return dateStr === tempStart;
    return dateStr === startDate;
  };

  const isEnd = (dateStr) => {
    if (pickPhase === 'start' && hoverDate) {
      const s = tempStart < hoverDate ? tempStart : hoverDate;
      const e = tempStart < hoverDate ? hoverDate : tempStart;
      return dateStr === e;
    }
    return dateStr === endDate;
  };

  const displayText = () => {
    if (!startDate && !endDate) return '';
    if (startDate === endDate) return dayjs(startDate).format('DD MMM YYYY');
    if (startDate && endDate)
      return `${dayjs(startDate).format('DD MMM YYYY')}  —  ${dayjs(endDate).format('DD MMM YYYY')}`;
    if (startDate) return dayjs(startDate).format('DD MMM YYYY');
    return '';
  };

  return (
    <div className="relative" ref={ref}>
      <label className="form-label">Tanggal *</label>
      <div
        className="form-input flex items-center gap-2 cursor-pointer"
        onClick={() => {
          setOpen(!open);
          if (!open) {
            setPickPhase(null);
            setTempStart(null);
            if (startDate) setViewDate(dayjs(startDate));
          }
        }}
      >
        <HiOutlineCalendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className={`text-sm truncate ${displayText() ? 'text-gray-900' : 'text-gray-400'}`}>
          {displayText() || 'Pilih tanggal'}
        </span>
      </div>
      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">
        {pickPhase === 'start'
          ? 'Klik tanggal kedua untuk rentang'
          : 'Klik 2x untuk rentang'}
      </p>

      {open && (
        <div className="absolute z-50 mt-1 bg-white rounded-xl shadow-xl border border-gray-200 p-4 w-[300px] right-0">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded-lg">
              <HiOutlineChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <span className="text-sm font-semibold text-gray-800">
              {MONTH_NAMES[viewDate.month()]} {viewDate.year()}
            </span>
            <button type="button" onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded-lg">
              <HiOutlineChevronRight className="w-5 h-5 text-gray-600" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAY_LABELS.map((d) => (
              <div key={d} className="text-center text-[10px] font-medium text-gray-400 py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1 mb-1">
              {week.map((cell, di) => {
                if (!cell) {
                  return <div key={di} className="aspect-square" />;
                }

                const inRange = isInRange(cell.date);
                const isS = isStart(cell.date);
                const isE = isEnd(cell.date);
                const heatBg = getHeatColor(cell.count);
                const isToday = cell.date === dayjs().format('YYYY-MM-DD');
                const hasHeat = cell.count > 0;

                return (
                  <button
                    key={di}
                    type="button"
                    className={`
                      aspect-square rounded-lg flex flex-col items-center justify-center
                      text-xs font-medium relative transition-all cursor-pointer
                      ${isS || isE
                        ? 'ring-2 ring-primary-500 bg-primary-600 text-white'
                        : inRange
                          ? 'bg-primary-100 text-primary-800'
                          : 'hover:bg-gray-100'
                      }
                      ${isToday && !isS && !isE ? 'ring-1 ring-primary-300' : ''}
                    `}
                    onClick={() => handleDayClick(cell.date)}
                    onMouseEnter={() => setHoverDate(cell.date)}
                    onMouseLeave={() => setHoverDate(null)}
                  >
                    <span className="leading-none">{cell.day}</span>
                    {/* Heat dot */}
                    {hasHeat && !isS && !isE && (
                      <span
                        className="w-1.5 h-1.5 rounded-full mt-0.5"
                        style={{ backgroundColor: heatBg }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {/* Legend */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t">
            <div className="flex items-center gap-1 text-[10px] text-gray-500">
              <span>Task:</span>
              {HEAT_COLORS.slice(1).map((c, i) => (
                <span key={i} className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: c }} />
              ))}
            </div>
            {(startDate || tempStart) && (
              <button
                type="button"
                className="text-[10px] text-red-500 hover:text-red-700"
                onClick={() => {
                  onChange('', '');
                  setPickPhase(null);
                  setTempStart(null);
                }}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
