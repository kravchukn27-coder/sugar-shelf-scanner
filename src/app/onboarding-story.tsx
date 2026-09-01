"use client";

import { useEffect, useRef } from "react";
import styles from "./onboarding-story.module.css";

const FINISH_MESSAGE = "sugar-onboarding-finish";
const START_MESSAGE = "sugar-onboarding-start";

export default function OnboardingStory({ onFinish, onStart }: { onFinish: () => void; onStart: () => void }) {
  const onFinishRef = useRef(onFinish);
  const onStartRef = useRef(onStart);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    onStartRef.current = onStart;
  }, [onStart]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === FINISH_MESSAGE) onFinishRef.current();
      if (event.data?.type === START_MESSAGE) onStartRef.current();
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
