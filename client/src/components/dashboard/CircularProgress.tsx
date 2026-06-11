interface CircularProgressProps {
  value: number;
  color: string;
  label: string;
}

export function CircularProgress({ value, color, label }: CircularProgressProps) {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative">
        <svg width="80" height="80" viewBox="0 0 80 80" className="transform -rotate-90">
          <circle
            cx="40"
            cy="40"
            r={radius}
            stroke="#E5E7EB"
            strokeWidth="8"
            fill="none"
          />
          <circle
            cx="40"
            cy="40"
            r={radius}
            stroke={color}
            strokeWidth="8"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold text-gray-900 dark:text-white">
            {value}%
          </span>
        </div>
      </div>
      <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">
        {label}
      </span>
    </div>
  );
}
