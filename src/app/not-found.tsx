import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-10 text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="max-w-md space-y-4 text-center">
        <p className="text-5xl font-bold text-gray-300 dark:text-zinc-700">404</p>
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          ← Back to home
        </Link>
      </div>
    </main>
  );
}
