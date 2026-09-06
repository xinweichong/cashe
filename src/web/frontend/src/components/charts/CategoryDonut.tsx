import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { getCategoryColor, formatCurrency } from '@/lib/utils';
import { useChartTheme } from '@/lib/chartTheme';

interface CategoryData {
  category: string;
  total: number;
}

export function CategoryDonut({ data }: { data: CategoryData[] }) {
  const { CHART_TOOLTIP_STYLE } = useChartTheme();
  if (!data || data.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-muted text-sm">
        No spending data
      </div>
    );
  }

  const total = data.reduce((sum, d) => sum + d.total, 0);

  return (
    <div className="relative w-full max-w-[220px] mx-auto h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="total"
            nameKey="category"
            cx="50%"
            cy="50%"
            innerRadius="60%"
            outerRadius="85%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={getCategoryColor(entry.category)} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(value, name) => [formatCurrency(Number(value ?? 0)), name]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center">
          <p className="text-xl font-bold">{formatCurrency(total)}</p>
          <p className="text-xs text-muted">Total spent</p>
        </div>
      </div>
    </div>
  );
}
