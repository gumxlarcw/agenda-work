import { glassCard } from './BentoGrid';

export default function SkeletonCard({ className = '', lines = 3, height }) {
  return (
    <div className={`${glassCard} p-5 animate-pulse ${className}`} style={height ? { minHeight: height } : {}}>
      <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`h-3 bg-gray-100 rounded mb-2 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}
