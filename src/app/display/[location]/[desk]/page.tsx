import { DisplayScreen } from './display-screen'

export const dynamic = 'force-dynamic'

export default async function DisplayPage({
  params,
  searchParams,
}: {
  params: Promise<{ location: string; desk: string }>
  searchParams: Promise<{ key?: string; demo?: string }>
}) {
  const { location, desk } = await params
  const { key = '', demo } = await searchParams
  return <DisplayScreen location={location} desk={desk} deskKey={key} demo={demo === '1'} />
}
