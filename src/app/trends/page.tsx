import { redirect } from 'next/navigation';

export default function TrendsPage(): never {
  redirect('/standings?view=trends');
}
