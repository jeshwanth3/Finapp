import { ComingSoon } from '@/components/ComingSoon'

export default function NetWorthPage() {
  return (
    <ComingSoon
      title="Net worth"
      phase="Phase 7"
      summary="Known assets minus known liabilities, per currency, never rendered without its as-of date and coverage ratio. A confidently wrong net worth is worse than a visibly partial one."
      blockedBy="A one-time list of assets email cannot see — property, cash, employer equity."
    />
  )
}
