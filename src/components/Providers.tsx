"use client";

/**
 * React Query Provider wrapper.
 *
 * Separated from root layout because QueryClient must be created
 * inside a client component, and the layout is a server component.
 */

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { SessionBoundary } from "@/components/auth/SessionBoundary";

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {pathname === "/access" ? children : <SessionBoundary>{children}</SessionBoundary>}
    </QueryClientProvider>
  );
}
