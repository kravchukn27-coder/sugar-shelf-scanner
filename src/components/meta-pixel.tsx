"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

declare global {
  interface Window {
    fbq?: (...arguments_: unknown[]) => void;
  }
}

type MetaPixelProps = { pixelId: string };

/** Loads Meta Pixel once and records one PageView per client-side route. */
export default function MetaPixel({ pixelId }: MetaPixelProps) {
  const pathname = usePathname();
  const initialized = useRef(false);

  function trackPageView() {
    window.fbq?.("track", "PageView");
  }

  useEffect(() => {
    if (initialized.current) trackPageView();
  }, [pathname]);

  return <>
    <Script id="meta-pixel" strategy="afterInteractive" onReady={() => {
      if (initialized.current) return;
      initialized.current = true;
      trackPageView();
    }}>{`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(pixelId)});`}</Script>
    <noscript><img alt="" height="1" width="1" style={{ display: "none" }} src={`https://www.facebook.com/tr?id=${encodeURIComponent(pixelId)}&ev=PageView&noscript=1`} /></noscript>
  </>;
}
