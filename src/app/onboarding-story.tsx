"use client";

import { useEffect, useRef } from "react";
import styles from "./onboarding-story.module.css";

const FINISH_MESSAGE = "sugar-onboarding-finish";

export default function OnboardingStory({ onFinish }: { onFinish: () => void }) {
  const onFinishRef = useRef(onFinish);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== FINISH_MESSAGE) return;
      onFinishRef.current();
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <div className={styles.stage} aria-label="Sugar.no introduction">
      <iframe
        className={styles.frame}
        src="/onboarding/sugar-investor-demo.html"
        title="Sugar.no introduction"
      />
    </div>
  );
}
