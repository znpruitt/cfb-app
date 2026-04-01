import { redirect } from 'next/navigation';

export default async function LeagueTrendsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<never> {
  const { slug } = await params;
  redirect(`/league/${slug}/standings?view=trends`);
}
