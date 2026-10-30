import { useEffect, useRef, useState } from "react";

interface CopyButtonProps {
  value: string;
  label?: string;
}

/** Small copy-to-clipboard button with a transient "Copied" state. */
export function CopyButton({ value, label = "Copy" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    };
  }, []);

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard permission denied: leave the label unchanged.
    }
  };

  return (
    <button
      type="button"
      className="ghost copy-button"
      onClick={onCopy}
      aria-label={`${label}: ${value}`}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
