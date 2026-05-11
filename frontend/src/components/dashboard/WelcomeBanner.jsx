import { useState, useEffect } from 'react';
import { HiOutlineFire } from 'react-icons/hi';

function getGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return { text: 'Selamat Pagi', icon: '☀️' };
  if (h >= 11 && h < 15) return { text: 'Selamat Siang', icon: '🌤️' };
  if (h >= 15 && h < 18) return { text: 'Selamat Sore', icon: '🌅' };
  return { text: 'Selamat Malam', icon: '🌙' };
}

function ProgressRing({ percent }) {
  const [animPercent, setAnimPercent] = useState(0);
  const radius = 40;
  const stroke = 6;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (animPercent / 100) * circumference;

  useEffect(() => {
    const timer = setTimeout(() => setAnimPercent(percent), 100);
    return () => clearTimeout(timer);
  }, [percent]);

  return (
    <div className="relative w-24 h-24 flex-shrink-0">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={radius} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={stroke} />
        <circle
          cx="48" cy="48" r={radius} fill="none"
          stroke="white" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-white text-lg font-bold">{Math.round(percent)}%</span>
      </div>
    </div>
  );
}

export default function WelcomeBanner({ user, stats, todayFocus }) {
  const greeting = getGreeting();
  const completionRate = stats?.completion_rate || 0;
  const streak = stats?.streak_days || 0;

  const dueCount = todayFocus?.due_today?.length || 0;
  const overdueCount = todayFocus?.overdue?.length || 0;
  let nudge = 'All clear for today! 🎉';
  if (overdueCount > 0) nudge = `${overdueCount} overdue item${overdueCount > 1 ? 's' : ''} butuh perhatian!`;
  else if (dueCount > 0) nudge = `${dueCount} task${dueCount > 1 ? 's' : ''} due today. Semangat!`;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-700 p-6 text-white">
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl animate-pulse" />
      <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-white/5 rounded-full blur-xl" />

      <div className="relative flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold truncate">
            {greeting.text}, {user?.username}! {greeting.icon}
          </h1>
          <p className="text-indigo-100 mt-1 text-sm">{nudge}</p>
          {streak > 0 && (
            <div className="flex items-center gap-1.5 mt-2 text-amber-200 text-sm font-medium">
              <HiOutlineFire className="w-4 h-4" />
              {streak}-day streak!
            </div>
          )}
        </div>
        <ProgressRing percent={completionRate} />
      </div>
    </div>
  );
}
