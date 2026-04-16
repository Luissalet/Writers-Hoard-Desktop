import type { WritingStatsData } from '../types';

interface ProgressChartProps {
  stats: WritingStatsData;
  dailyGoal: number | null;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function ProgressChart({ stats, dailyGoal }: ProgressChartProps) {
  const { last7Days } = stats;

  // Find max to scale bars
  const maxWords = Math.max(
    ...last7Days.map((d) => d.words),
    dailyGoal || 0,
    1 // Minimum 1 to avoid division by zero
  );

  // Get day name for each entry
  const getDayLabel = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    const dayIndex = date.getDay() === 0 ? 6 : date.getDay() - 1; // Adjust for Mon-Sun
    return DAYS[dayIndex];
  };

  return (
    <div className="space-y-4">
      {/* Chart Grid */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        {/* Goal line (if exists) */}
        {dailyGoal && (
          <div className="mb-4 text-xs text-gray-500 font-medium">
            Daily Goal: {dailyGoal} words
          </div>
        )}

        {/* Bars */}
        <div className="flex items-end justify-between gap-2 h-40">
          {last7Days.map((day, idx) => {
            const barHeight = (day.words / maxWords) * 160; // 160px max height
            const isGoalMet = dailyGoal ? day.words >= dailyGoal : false;

            return (
              <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                {/* Word count label */}
                <div className="h-5 text-xs font-medium text-gray-700">
                  {day.words > 0 ? day.words : ''}
                </div>

                {/* Bar */}
                <div className="w-full flex-1 flex items-end justify-center">
                  <div
                    className={`w-full rounded-t-md transition-all ${
                      isGoalMet
                        ? 'bg-gradient-to-t from-accent-gold to-accent-gold/80'
                        : 'bg-gradient-to-t from-blue-400 to-blue-300'
                    }`}
                    style={{ height: `${barHeight}px` }}
                  />
                </div>

                {/* Day label */}
                <div className="text-xs font-medium text-gray-600 mt-1">
                  {getDayLabel(day.date)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Goal line (visual reference) */}
        {dailyGoal && (
          <div className="mt-6 relative h-6 bg-gray-50 rounded border border-gray-200">
            <div
              className="absolute h-full bg-dashed border-t-2 border-dashed border-gray-300 pointer-events-none"
              style={{ left: `${(dailyGoal / maxWords) * 100}%` }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
              {dailyGoal > 0 ? `Goal: ${dailyGoal}` : ''}
            </div>
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Words" value={stats.totalWords.toLocaleString()} />
        <StatCard label="Daily Avg" value={stats.averageDaily.toLocaleString()} />
        <StatCard label="Best Day" value={Math.max(...last7Days.map((d) => d.words)).toLocaleString()} />
        <StatCard label="Days Active" value={last7Days.filter((d) => d.words > 0).length.toString()} />
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 text-center">
      <div className="text-xs font-medium text-gray-600">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}
