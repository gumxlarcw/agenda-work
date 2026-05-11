import { useState, useMemo } from 'react';
import dayjs from 'dayjs';
import { HiOutlineFire } from 'react-icons/hi';
import { DAY_LABELS, MONTH_NAMES, HEAT_COLORS, getHeatColor, getMonthWeeks, buildCountMap } from './calendarUtils';

export default function CalendarHeatmap({ data = [] }) {
  const [tooltip, setTooltip] = useState(null);

  const months = useMemo(() => {
    const today = dayjs();
    const countMap = buildCountMap(data);

    const result = [];
    for (let i = 5; i >= 0; i--) {
      const m = today.subtract(i, 'month');
      result.push({
        year: m.year(),
        month: m.month(),
        label: `${MONTH_NAMES[m.month()]} ${m.year()}`,
        weeks: getMonthWeeks(m.year(), m.month(), countMap, today),
      });
    }
    return result;
  }, [data]);

  const handleMouseEnter = (e, cell) => {
    if (!cell || cell.isFuture) return;
    const rect = e.target.getBoundingClientRect();
    setTooltip({
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
      text: `${cell.count} task${cell.count !== 1 ? 's' : ''} — ${dayjs(cell.date).format('DD MMM YYYY')}`,
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <HiOutlineFire className="w-4 h-4 text-orange-500" />
          Task Activity
        </h3>
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <span>Less</span>
          {HEAT_COLORS.map((color, i) => (
            <span
              key={i}
              className="inline-block rounded-sm"
              style={{ width: 12, height: 12, backgroundColor: color }}
            />
          ))}
          <span>More</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {months.map((m) => (
          <div key={`${m.year}-${m.month}`} className="min-w-0">
            <p className="text-xs font-semibold text-gray-700 mb-2 text-center">
              {m.label}
            </p>
            <div className="grid grid-cols-7 gap-[3px] mb-[3px]">
              {DAY_LABELS.map((label) => (
                <div key={label} className="text-center text-[10px] sm:text-[9px] leading-none text-gray-400 font-medium">
                  {label}
                </div>
              ))}
            </div>
            {m.weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-[3px] mb-[3px]">
                {week.map((cell, di) => (
                  <div
                    key={di}
                    className={`aspect-square rounded-[3px] flex items-center justify-center text-[10px] sm:text-[9px] font-medium leading-none select-none
                      ${!cell ? '' : cell.isFuture ? 'border border-gray-100' : 'cursor-pointer'}`}
                    style={{
                      backgroundColor: !cell ? 'transparent' : cell.isFuture ? 'transparent' : getHeatColor(cell.count),
                      color: !cell
                        ? 'transparent'
                        : cell.isFuture
                          ? '#d1d5db'
                          : cell.count >= 3
                            ? '#fff'
                            : '#374151',
                    }}
                    onMouseEnter={(e) => cell && handleMouseEnter(e, cell)}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    {cell ? cell.day : ''}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      {tooltip && (
        <div
          className="fixed z-50 px-2.5 py-1.5 text-xs text-white bg-gray-800 rounded-lg shadow-lg pointer-events-none whitespace-nowrap"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
