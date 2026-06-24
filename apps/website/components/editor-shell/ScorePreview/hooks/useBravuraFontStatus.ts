import { useEffect, useState } from "react";

/**
 * Bravura 只用于 SMuFL 音乐符号。这里显式探测字体加载状态，
 * 避免字体失败时用户看到私用区乱码却没有任何提示。
 */
export const useBravuraFontStatus = (): "loading" | "ready" | "failed" => {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  useEffect(() => {
    if (!("fonts" in document)) {
      queueMicrotask(() => setStatus("failed"));
      return;
    }

    let mounted = true;
    document.fonts
      .load("16px Bravura")
      .then((fonts) => {
        if (!mounted) return;
        setStatus(fonts.length > 0 ? "ready" : "failed");
      })
      .catch(() => {
        if (mounted) setStatus("failed");
      });

    return () => {
      mounted = false;
    };
  }, []);

  return status;
};

