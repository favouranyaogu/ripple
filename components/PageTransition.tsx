"use client";

import { usePathname } from "next/navigation";

/**
 * Replays a soft fade/rise animation whenever the route changes (the keyed div
 * remounts per pathname). The animation itself lives in globals.css and is
 * disabled for users who prefer reduced motion.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
