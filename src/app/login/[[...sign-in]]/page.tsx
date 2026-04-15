import { SignIn } from '@clerk/nextjs';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-zinc-100">Turf War</h1>
        <p className="mt-1 text-sm text-zinc-400">Commissioner access</p>
      </div>
      <SignIn routing="path" path="/login" forceRedirectUrl="/admin" />
    </main>
  );
}
