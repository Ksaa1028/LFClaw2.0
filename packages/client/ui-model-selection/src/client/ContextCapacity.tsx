/** Supplies current catalog capacity without rewriting historical request projections. */
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from './directory.ts'

/** Live directory and conversation-owned meter renderer. */
export interface ContextCapacityProps {
  directory: SnapshotStore<ModelDirectoryState>
  renderMeter: (contextWindow: number | null) => ReactNode
}

/**
 * Recalculate the meter when the selected model or its catalog capacity changes.
 * @param props - Session directory and presentation callback.
 * @returns The conversation meter, hidden when current capacity is unavailable.
 */
export function ContextCapacity({ directory, renderMeter }: ContextCapacityProps) {
  const state = useSyncExternalStore(directory.subscribe, directory.getSnapshot)
  const current = state.current
  const model =
    current === null
      ? undefined
      : state.groups.find(group => group.id === current.provider)?.models.find(model => model.id === current.model)
  return renderMeter(state.routable === true ? (model?.contextWindow ?? null) : null)
}
