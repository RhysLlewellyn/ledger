import {Skeleton} from '../../skeleton.tsx'

export default function Loading() {
  // The customer's name is not known until the query returns, so the heading
  // cannot be the real one. "Customer" is honest; a guessed name would not be.
  return (
    <Skeleton
      title="Customer"
      lead="Subscriptions, revenue movements and recent activity for one account."
      rows={16}
    />
  )
}
