/** Save/delete feedback stays mounted when an expert dialog or page closes. */
import { useEffect, useState } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'

/** Subscribe the app overlay to transient successful operations. */
export interface ExpertFeedbackProps {
  subscribe: (listener: (text: string) => void) => () => void
}
/** Render success feedback outside the expert page. @param props - Overlay subscription. @returns Active toast or nothing. */
export function ExpertFeedback({ subscribe }: ExpertFeedbackProps) {
  const [notice, setNotice] = useState<{ text: string; sequence: number } | null>(null)
  useEffect(
    () =>
      subscribe((text) => {
        setNotice(previous => ({ text, sequence: (previous?.sequence ?? 0) + 1 }))
      }),
    [subscribe],
  )
  return notice ? (
    <Toast
      key={notice.sequence}
      text={notice.text}
      tone="success"
      onDone={() => {
        setNotice(null)
      }}
    />
  ) : null
}
