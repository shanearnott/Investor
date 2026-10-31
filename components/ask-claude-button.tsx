"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/** Compact Claude-style asterisk mark — eight petals in a radial
 *  arrangement, rendered inline so it inherits text colour. */
function ClaudeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-16 -16 32 32"
      width="14"
      height="14"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => (
        <ellipse
          key={d}
          cx="0"
          cy="-9"
          rx="2.2"
          ry="5"
          transform={`rotate(${d})`}
        />
      ))}
    </svg>
  );
}

/** Single-click copy-to-Claude affordance. Builds a prompt header + a
 *  JSON slice of the current page's state + a trailing "My question:"
 *  placeholder, puts the whole thing on the clipboard. No panel, no
 *  textarea — the user types their question in Claude after pasting. */
export function AskClaudeButton({
  heading,
  dataLabel,
  buildData,
  displayCurrency,
}: {
  heading: string;
  dataLabel: string;
  buildData: () => unknown;
  displayCurrency: string;
}) {
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = (kind: "ok" | "err") => {
    setStatus(kind);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus("idle"), 2500);
  };

  const handleClick = async () => {
    let payload: string;
    try {
      payload = JSON.stringify(buildData(), null, 2);
    } catch {
      flash("err");
      return;
    }
    const text = `${heading}\n\n`
      + `${dataLabel} (display currency: ${displayCurrency}, today: ${new Date().toISOString().slice(0, 10)}):\n\n`
      + "```json\n"
      + payload
      + "\n```\n\n"
      + "My question:";
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      flash("ok");
    } catch {
      flash("err");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={handleClick}>
        <span>Ask</span>
        <ClaudeMark className="text-[#D97757]" />
      </Button>
      {status === "ok" ? (
        <span className="text-[11px] text-emerald-700">Query copied, paste to Claude</span>
      ) : status === "err" ? (
        <span className="text-[11px] text-rose-700">Couldn&apos;t copy — clipboard blocked</span>
      ) : null}
    </div>
  );
}
