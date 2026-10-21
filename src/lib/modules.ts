export type ModuleId = 'scanner' | 'pulse' | 'breadth'

export interface ModuleDef {
  id: ModuleId
  label: string
  hash: string
}

export const MODULES: ModuleDef[] = [
  { id: 'scanner', label: 'Scanner', hash: '#scanner' },
  { id: 'pulse', label: 'Market Pulse', hash: '#pulse' },
]

export const DEFAULT_MODULE: ModuleId = 'scanner'

/** `#pulse` or `#pulse/sectors` → 'pulse'; anything unknown → default. */
export function moduleFromHash(hash: string, modules: readonly ModuleDef[] = MODULES): ModuleId {
  const head = hash.replace(/^#/, '').split('/')[0]?.toLowerCase() ?? ''
  return modules.find((m) => m.id === head)?.id ?? DEFAULT_MODULE
}

/** Sub-tab segment after the module, e.g. `#pulse/sectors` → 'sectors'. */
export function subFromHash(hash: string): string | null {
  const parts = hash.replace(/^#/, '').split('/')
  return parts[1] ? parts[1].toLowerCase() : null
}
