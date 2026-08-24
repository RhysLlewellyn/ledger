import {Skeleton} from '../skeleton.tsx'

export default function Loading() {
  return (
    <Skeleton
      title="Customers"
      lead="Every filter, sort and page is in the address bar, and every one of them is applied by Postgres rather than in the browser. Copy the URL and you have copied the view."
      rows={16}
    />
  )
}
