"use client";

import { AppHeader } from "@/components/AppHeader";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg-primary">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
