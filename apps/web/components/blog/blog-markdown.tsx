import { Fragment, type ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-fg">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="rounded bg-surface px-1.5 py-0.5 font-mono text-[0.9em] text-fg"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={idx}>{part}</Fragment>;
  });
}

export function BlogMarkdown({ content }: { content: string }) {
  const blocks = content.replace(/\r\n/g, "\n").split(/\n\n+/);

  return (
    <div className="flex flex-col gap-5 text-[16px] leading-relaxed text-fg-muted">
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        if (trimmed.startsWith("### ")) {
          return (
            <h3 key={i} className="mt-2 text-lg font-semibold text-fg">
              {renderInline(trimmed.slice(4))}
            </h3>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <h2 key={i} className="mt-4 text-2xl font-semibold tracking-tight text-fg">
              {renderInline(trimmed.slice(3))}
            </h2>
          );
        }
        if (trimmed.startsWith("# ")) {
          return (
            <h2 key={i} className="mt-4 text-2xl font-semibold tracking-tight text-fg">
              {renderInline(trimmed.slice(2))}
            </h2>
          );
        }

        const lines = trimmed.split("\n").map((l) => l.trim());
        if (lines.every((l) => l.startsWith("- ") || l.startsWith("* "))) {
          return (
            <ul key={i} className="list-disc space-y-2 pl-6">
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }

        if (lines.every((l) => /^\d+\.\s+/.test(l))) {
          return (
            <ol key={i} className="list-decimal space-y-2 pl-6">
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.replace(/^\d+\.\s+/, ""))}</li>
              ))}
            </ol>
          );
        }

        return <p key={i}>{renderInline(trimmed.replace(/\n/g, " "))}</p>;
      })}
    </div>
  );
}

