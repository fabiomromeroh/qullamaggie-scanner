/**
 * Refresh server/data/finviz-group-members.json from Finviz.
 * Run where finviz.com/screener.ashx answers. Does not overwrite the file
 * unless every group page succeeds. Exits non-zero on a block or parse failure.
 */
import { membershipSnapshotPath } from '../server/groupMembers.ts'
import { buildAndWriteMembershipSnapshot } from '../server/groupMembersBuild.ts'

async function main(): Promise<void> {
  const dest = membershipSnapshotPath()
  process.stdout.write(`membership snapshot -> ${dest}\n`)
  const snapshot = await buildAndWriteMembershipSnapshot(dest)
  const unique = new Set<string>()
  for (const group of Object.values(snapshot.groups)) {
    for (const ticker of group.tickers) unique.add(ticker)
  }
  process.stdout.write(
    `wrote groups=${Object.keys(snapshot.groups).length} uniqueTickers=${unique.size} generatedAt=${snapshot.generatedAt}\n`,
  )
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'membership build failed'
  process.stderr.write(`${message}\n`)
  process.exit(1)
})
