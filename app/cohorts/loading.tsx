import {Skeleton} from '../skeleton.tsx'

export default function Loading() {
  return (
    <Skeleton
      title="Cohorts"
      lead="Retention by signup month. A customer counts as retained in a month if any subscription of theirs was running during it."
      rows={16}
    />
  )
}
