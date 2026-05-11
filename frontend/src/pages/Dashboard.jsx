import { useState } from 'react';
import {
  HiOutlineClipboardList, HiOutlineCheckCircle,
  HiOutlineClock, HiOutlineExclamation,
  HiOutlineUsers, HiOutlineChevronDown,
} from 'react-icons/hi';
import useDashboard from '../hooks/useDashboard';
import useDashboardLayout from '../hooks/useDashboardLayout';
import CalendarHeatmap from '../components/CalendarHeatmap';
import BentoGrid, { getGridItemProps, glassCard } from '../components/dashboard/BentoGrid';
import WelcomeBanner from '../components/dashboard/WelcomeBanner';
import StatCard from '../components/dashboard/StatCard';
import TodayFocus from '../components/dashboard/TodayFocus';
import RecentTasks from '../components/dashboard/RecentTasks';
import RecentNotes from '../components/dashboard/RecentNotes';
import ActivityFeed from '../components/dashboard/ActivityFeed';
import EventCalendar from '../components/dashboard/EventCalendar';
import QuickAddBar from '../components/dashboard/QuickAddBar';
import SkeletonCard from '../components/dashboard/SkeletonCard';

export default function Dashboard() {
  const {
    user, isAdmin,
    stats, todayFocus, recentTasks, recentNotes, activityFeed,
    heatmapData, userStats, events,
    statsLoading, focusLoading, tasksLoading, notesLoading, activityLoading, eventsLoading,
    statsError, focusError, tasksError, notesError, activityError, eventsError,
    completeTask, refetchAll, refetchFocus, changeEventMonth,
  } = useDashboard();

  const { layouts, layoutLoading, onLayoutChange } = useDashboardLayout();
  const [showUserStats, setShowUserStats] = useState(false);

  if (layoutLoading) {
    return (
      <div className="space-y-4 animate-fadeIn pb-20 sm:pb-4">
        <SkeletonCard lines={2} height={120} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <SkeletonCard key={i} lines={1} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn pb-20 sm:pb-4">
      {/* Fixed: Welcome Banner (always top) */}
      {statsLoading ? (
        <SkeletonCard lines={2} height={120} />
      ) : (
        <WelcomeBanner user={user} stats={stats} todayFocus={todayFocus} />
      )}

      {/* Draggable Grid */}
      <BentoGrid layouts={layouts} onLayoutChange={onLayoutChange}>
        <div key="stat-0" {...getGridItemProps('stat-0')}>
          {statsLoading ? <SkeletonCard lines={1} className="h-full" /> : (
            <StatCard title="Total Tasks" value={stats?.total} icon={HiOutlineClipboardList}
              color="bg-blue-500" link="/tasks" trend={stats?.trends?.total_change}
              progressPercent={stats?.completion_rate} />
          )}
        </div>
        <div key="stat-1" {...getGridItemProps('stat-1')}>
          {statsLoading ? <SkeletonCard lines={1} className="h-full" /> : (
            <StatCard title="Completed" value={stats?.completed} icon={HiOutlineCheckCircle}
              color="bg-green-500" link="/tasks" trend={stats?.trends?.completed_change} />
          )}
        </div>
        <div key="stat-2" {...getGridItemProps('stat-2')}>
          {statsLoading ? <SkeletonCard lines={1} className="h-full" /> : (
            <StatCard title="In Progress" value={stats?.in_progress} icon={HiOutlineClock}
              color="bg-amber-500" link="/tasks" trend={stats?.trends?.in_progress_change} />
          )}
        </div>
        <div key="stat-3" {...getGridItemProps('stat-3')}>
          {statsLoading ? <SkeletonCard lines={1} className="h-full" /> : (
            <StatCard title="Overdue" value={stats?.overdue} icon={HiOutlineExclamation}
              color="bg-red-500" link="/tasks" />
          )}
        </div>
        <div key="today-focus" {...getGridItemProps('today-focus')}>
          <TodayFocus data={todayFocus} onComplete={completeTask}
            loading={focusLoading} error={focusError} onRetry={refetchFocus} />
        </div>
        <div key="calendar-heatmap" {...getGridItemProps('calendar-heatmap')}>
          <div className={glassCard + ' p-4 h-full'}>
            <CalendarHeatmap data={heatmapData} />
          </div>
        </div>
        <div key="event-calendar" {...getGridItemProps('event-calendar')}>
          <EventCalendar
            events={events}
            loading={eventsLoading}
            error={eventsError}
            onMonthChange={changeEventMonth}
          />
        </div>
        <div key="recent-tasks" {...getGridItemProps('recent-tasks')}>
          <RecentTasks tasks={recentTasks} onComplete={completeTask}
            loading={tasksLoading} error={tasksError} />
        </div>
        <div key="activity-feed" {...getGridItemProps('activity-feed')}>
          <ActivityFeed items={activityFeed} loading={activityLoading} error={activityError} />
        </div>
        <div key="recent-notes" {...getGridItemProps('recent-notes')}>
          <RecentNotes notes={recentNotes} loading={notesLoading} error={notesError} />
        </div>
      </BentoGrid>

      {/* Fixed: Quick Add Bar (always bottom) */}
      <QuickAddBar onCreated={refetchAll} />

      {/* Admin: User Stats (collapsible) */}
      {isAdmin && userStats.length > 0 && (
        <div className={glassCard}>
          <button
            onClick={() => setShowUserStats(!showUserStats)}
            className="w-full p-4 flex items-center justify-between text-left"
          >
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <HiOutlineUsers className="w-5 h-5 text-purple-500" />
              User Statistics
            </h2>
            <HiOutlineChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showUserStats ? 'rotate-180' : ''}`} />
          </button>
          {showUserStats && (
            <>
              <div className="overflow-x-auto hidden md:block border-t">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">User</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">Tasks</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">Completed</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">In Progress</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">Pending</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">High Priority</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">Todos</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">Reminders</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {userStats.map(s => (
                      <tr key={s.user_id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-medium text-gray-900">{s.username}</td>
                        <td className="px-4 py-3 text-center">{s.total_tasks || 0}</td>
                        <td className="px-4 py-3 text-center"><span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-0.5 rounded">{s.completed || 0}</span></td>
                        <td className="px-4 py-3 text-center"><span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-0.5 rounded">{s.in_progress || 0}</span></td>
                        <td className="px-4 py-3 text-center"><span className="bg-gray-100 text-gray-800 text-xs font-medium px-2 py-0.5 rounded">{s.pending || 0}</span></td>
                        <td className="px-4 py-3 text-center"><span className="bg-red-100 text-red-800 text-xs font-medium px-2 py-0.5 rounded">{s.high_priority_count || 0}</span></td>
                        <td className="px-4 py-3 text-center">{s.pending_todos || 0}</td>
                        <td className="px-4 py-3 text-center">{s.active_reminders || 0}</td>
                        <td className="px-4 py-3 text-center">{s.total_notes || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="block md:hidden divide-y border-t">
                {userStats.map(s => (
                  <div key={s.user_id} className="p-4 space-y-2">
                    <p className="font-medium text-gray-900">{s.username}</p>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-900">{s.total_tasks || 0}</div><div className="text-gray-500">Tasks</div></div>
                      <div className="bg-green-50 rounded-lg p-2"><div className="font-bold text-green-700">{s.completed || 0}</div><div className="text-green-600">Done</div></div>
                      <div className="bg-yellow-50 rounded-lg p-2"><div className="font-bold text-yellow-700">{s.in_progress || 0}</div><div className="text-yellow-600">Progress</div></div>
                      <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-700">{s.pending || 0}</div><div className="text-gray-500">Pending</div></div>
                      <div className="bg-red-50 rounded-lg p-2"><div className="font-bold text-red-700">{s.high_priority_count || 0}</div><div className="text-red-600">Priority</div></div>
                      <div className="bg-blue-50 rounded-lg p-2"><div className="font-bold text-blue-700">{s.pending_todos || 0}</div><div className="text-blue-600">Todos</div></div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
