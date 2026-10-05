import { GROUP_PERIODS } from '../lib/groupPeriod'
import type { DashboardData } from '../types'
import { MetricTip } from './MetricTip'

/** Workflow counts under the filter bar. Each figure is a metric tooltip. */
export function ScanStatsLine({ data }: { data: DashboardData }) {
  if (data.scanUniverseSize == null) return null
  const deep = data.shortlistCount ?? data.stage15Count ?? data.scanUniverseSize
  const showPrefilter =
    data.stage15BelowSma200Count != null || data.stage15BelowSma50Count != null
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 font-mono">
      <MetricTip id="stage1Universe">Univ {data.stage1Count ?? data.scanUniverseSize}</MetricTip>
      {data.stage15Count != null ? (
        <>
          <span aria-hidden>→</span>
          <MetricTip id="stage15Sma">SMA {data.stage15Count}</MetricTip>
        </>
      ) : null}
      <span aria-hidden>→</span>
      <MetricTip id="stage2Deep">deep {deep}</MetricTip>
      <span aria-hidden>→</span>
      <MetricTip id="scanHits">{data.scanHitCount ?? 0} hits</MetricTip>
      <span aria-hidden>·</span>
      <MetricTip id="scanBelow200">below200 {data.scanBelow200Count ?? 0}</MetricTip>
      <span aria-hidden>·</span>
      <MetricTip id="scanFails">fails {data.scanFailCount ?? 0}</MetricTip>
      {data.leadingGroupsMeta ? (
        <>
          <span aria-hidden>·</span>
          <MetricTip id="leadingGroupsUniverse">
            top{data.leadingGroupsMeta.groups.length} ·{' '}
            {GROUP_PERIODS[data.leadingGroupsMeta.period]?.label ??
              data.leadingGroupsMeta.period.toUpperCase()}
          </MetricTip>
        </>
      ) : null}
      {showPrefilter ? (
        <>
          <span aria-hidden>·</span>
          <MetricTip id="stage15Below200">prefilter −200:{data.stage15BelowSma200Count ?? 0}</MetricTip>
          <MetricTip id="stage15Below50">−50:{data.stage15BelowSma50Count ?? 0}</MetricTip>
          <MetricTip id="stage15Missing">
            miss:{data.stage15MissingSmaCount ?? '—'}
          </MetricTip>
        </>
      ) : null}
    </span>
  )
}
