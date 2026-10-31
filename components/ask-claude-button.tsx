"use client";

import { useRef, useState } from "react";
import { Check, ClipboardCopy, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";

/** "Copy for Claude" affordance that assembles a page-scoped JSON
 *  payload plus a prompt header and (optionally) the user's question,
 *  then puts the whole thing on the clipboard so the user can paste
 *  into Claude.ai or Claude Desktop. No API calls; no key; works on
 *  iPad as long as the clipboard permission grant goes through. */
export function AskClaudeButton({
  heading,
  dataLabel,
  buildData,
  displayCurrency,
}: {
  /** One-line system-style preamble pasted above the data. */
  heading: string;
  /** Short label for the data block (e.g. "Projections context"). */
  dataLabel: string;
  /** Called at copy-time so the payload reflects the current state. */
  buildData: () => unknown;
  /** Primary currency the UI is using, surfaced so Claude knows what
   *  the numbers are denominated in. */
  displayCurrency: string;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [copied, setCopied] = useState<"ok" | "err" | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = (kind: "ok" | "err") => {
    setCopied(kind);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(null), 2500);
  };

  const handleCopy = async () => {
    let payload: string;
    try {
      payload = JSON.stringify(buildData(), null, 2);
    } catch {
      flash("err");
      return;
    }
    const trimmed = question.trim();
    const text = `${heading}\n\n`
      + `${dataLabel} (display currency: ${displayCurrency}, today: ${new Date().toISOString().slice(0, 10)}):\n\n`
      + "```json\n"
      + payload
      + "\n```\n\n"
      + (trimmed ? `My question:\n${trimmed}` : "My question:");
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      flash("ok");
    } catch {
      flash("err");
    }
  };

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <ClipboardCopy className="h-3.5 w-3.5" /> Copy for Claude
      </Button>
    );
  }

  return (
    <div className="rounded-md border bg-background p-2 space-y-2 w-full sm:max-w-md">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          Ask Claude · via clipboard
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md p-0.5 text-muted-foreground hover:bg-accent"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <Textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Optional — type your question here, or leave blank and type it in Claude after pasting."
        rows={3}
        className="text-xs"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {copied === "ok"
            ? "Copied. Paste into Claude."
            : copied === "err"
              ? "Couldn't copy — clipboard blocked."
              : "Nothing leaves your device until you paste."}
        </span>
        <Button size="sm" variant={copied === "ok" ? "default" : "outline"} onClick={handleCopy}>
          {copied === "ok" ? (
            <><Check className="h-3.5 w-3.5" /> Copied</>
          ) : (
            <><ClipboardCopy className="h-3.5 w-3.5" /> Copy</>
          )}
        </Button>
      </div>
    </div>
  );
}
