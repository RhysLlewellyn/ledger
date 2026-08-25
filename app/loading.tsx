import {Skeleton} from './skeleton.tsx'

export default function Loading() {
  return (
    <Skeleton
      title="Overview"
      lead="Ledger is an invented subscription business; every figure below is computed from its billing history by the database, not stored anywhere as a total."
      rows={49}
    />
  )
}
