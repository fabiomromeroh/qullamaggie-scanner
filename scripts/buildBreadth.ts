/**
 * Build server/data/breadth-snapshot.json on a host that can afford ~1,850
 * Yahoo requests (e.g. the box), then commit/push it like the membership file.
 */
import { computeBreadth, snapshotPath, writeResultAtomic } from '../server/breadthJob.ts'
import { membershipUniverse } from '../server/marketPulse.ts'

async function main(): Promise<void> {
  const { tickers } = membershipUniverse()
  const dest = snapshotPath()
  process.stdout.write(`breadth snapshot -> ${dest} (${tickers.length} tickers)\n`)
  let last = 0
  const result = await computeBreadth(tickers, {
    onProgress: (done, failed) => {
      if (done - last >= 200 || done === tickers.length) {
        last = done
        process.stdout.write(`  ${done}/${tickers.length} (failed ${failed})\n`)
      }
    },
  })
  if (!result.rows.length) throw new Error('breadth produced no rows; snapshot not written')
  writeResultAtomic(dest, result)
  process.stdout.write(
    `wrote rows=${result.rows.length} requests=${result.requests} failed=${result.failed} runtimeMs=${result.runtimeMs} newest=${result.rows[0]?.date}\n`,
  )
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : 'breadth build failed'}\n`)
  process.exit(1)
})
