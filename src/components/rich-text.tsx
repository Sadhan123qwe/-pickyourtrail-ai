import { Fragment } from "react";

/** Renders plain text with **bold** and line breaks. No HTML is injected, so model output can't run script. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <div className={className}>
      {paragraphs.map((p, i) => (
        <p key={i} className={i ? "mt-2" : undefined}>
          {p.split("\n").map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {line.split(/(\*\*[^*]+\*\*)/g).map((part, k) =>
                part.startsWith("**") && part.endsWith("**") ? <strong key={k}>{part.slice(2, -2)}</strong> : <Fragment key={k}>{part}</Fragment>,
              )}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

export function stripMarkdown(text: string): string {
  return text.replace(/\*\*/g, "");
}
