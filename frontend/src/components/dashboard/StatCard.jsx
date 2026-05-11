import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { glassCard } from './BentoGrid';

function useCountUp(target, duration = 800) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!target) { setCount(0); return; }
    let start = 0;
    const step = Math.max(1, Math.ceil(target / (duration / 16)));
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setCount(target); clearInterval(timer); }
      else setCount(start);
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return count;
}

function TrendBadge({ change }) {
  if (change === undefined || change === null) return null;
  const isUp = change > 0;
  const isDown = change < 0;
  const color = isUp ? 'text-green-600 bg-green-50' : isDown ? 'text-red-600 bg-red-50' : 'text-gray-500 bg-gray-50';
  const arrow = isUp ? '↑' : isDown ? '↓' : '→';
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ${color}`}>
      {arrow}{Math.abs(change)}
    </span>
  );
}

export default function StatCard({ title, value, icon: Icon, color, link, trend, progressPercent }) {
  const displayValue = useCountUp(value || 0);

  return (
    <Link to={link} className={`${glassCard} p-5 block group hover:scale-[1.02] hover:shadow-lg h-full overflow-hidden`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">{title}</p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-3xl font-bold text-gray-900">{displayValue}</span>
            <TrendBadge change={trend} />
          </div>
        </div>
        <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
      {progressPercent !== undefined && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Completion</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-1000"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}
    </Link>
  );
}
