"use client";

import { useEffect } from "react";

export default function InvestorsPage() {
  useEffect(() => {
    window.location.replace("/investor-briefing.html");
  }, []);

  return null;
}
