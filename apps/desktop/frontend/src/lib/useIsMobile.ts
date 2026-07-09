import { useEffect, useState } from "react";

/** Below Tailwind's `md` breakpoint (768px) — a phone-width viewport, where
 *  side-by-side chrome (editor + right panel, split panes) has to collapse to
 *  a single column. Matches the `md:` prefixes used in the app shell. */
const QUERY = "(max-width: 767px)";

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}
