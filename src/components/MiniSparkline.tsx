import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts'
import type { SparkPoint } from '../types'

export function MiniSparkline({ data, positive }: { data: SparkPoint[]; positive?: boolean }) {
  if (!data.length) return null
  const color = positive === false ? '#f07178' : '#3dd68c'
  return (
    <div className="h-8 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <YAxis domain={['dataMin', 'dataMax']} hide />
          <Line
            type="monotone"
            dataKey="c"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
