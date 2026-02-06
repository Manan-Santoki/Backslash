import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-tertiary px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block">
            <span className="text-2xl font-bold text-accent font-mono">
              LeafEdit
            </span>
          </Link>
        </div>
        <div className="rounded-lg border border-border bg-bg-primary p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
