import { ComingSoon } from '@/components/ComingSoon'

export default function InvestmentsPage() {
  return (
    <ComingSoon
      title="Investments"
      phase="Phase 9"
      summary="Units, cost basis, market value and XIRR, priced from the free public AMFI NAV feed. Holdings are reconstructed from SIP emails rather than scraped. Reports results; never advises."
      blockedBy="Confirmation of whether any US brokerage or retirement accounts exist — the inbox survey found none."
    />
  )
}
