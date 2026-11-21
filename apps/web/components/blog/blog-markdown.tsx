import { Fragment, type ReactNode } from "react";

function isSafeUrl(url: string | undefined): url is string {
  return !!url && (url.startsWith("https://") || url.startsWith("http://") || url.startsWith("/"));
}

function renderHashtagsAndText(
  text: string,
  keyPrefix: string,
  onTagClick?: (tag: string) => void,
): ReactNode[] {
  const parts = text.split(/(#[a-zA-ZçğıöşüÇĞİÖŞÜ0-9_-]{2,32})/g);
  return parts.map((part, idx) => {
    if (part.startsWith("#") && part.length > 2) {
      const cleanTag = part.slice(1);
      if (onTagClick) {
        return (
          <button
            key={`${keyPrefix}-tag-${idx}`}
            type="button"
            onClick={() => onTagClick(cleanTag)}
            className="inline font-medium text-neon-pink hover:underline"
          >
            {part}
          </button>
        );
      }
      return (
        <span key={`${keyPrefix}-tag-${idx}`} className="font-medium text-neon-pink">
          {part}
        </span>
      );
    }
    return <Fragment key={`${keyPrefix}-txt-${idx}`}>{part}</Fragment>;
  });
}

function renderInline(text: string, onTagClick?: (tag: string) => void): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-fg">
          {renderHashtagsAndText(part.slice(2, -2), `b-${idx}`, onTagClick)}
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
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, label, href] = linkMatch;
      if (isSafeUrl(href)) {
        const external = href.startsWith("http");
        return (
          <a
            key={idx}
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            className="font-medium text-fg underline decoration-neon-pink/60 underline-offset-4 hover:text-neon-pink"
          >
            {label}
          </a>
        );
      }
    }
    return <Fragment key={idx}>{renderHashtagsAndText(part, `p-${idx}`, onTagClick)}</Fragment>;
  });
}

export function BlogMarkdown({
  content,
  onTagClick,
}: {
  content: string;
  onTagClick?: (tag: string) => void;
}) {
  const blocks = content.replace(/\r\n/g, "\n").split(/\n\n+/);

  return (
    <div className="flex flex-col gap-5 text-[16px] leading-[1.8] text-fg-muted">
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
        if (imgMatch && isSafeUrl(imgMatch[2])) {
          const [, alt, src] = imgMatch;
          return (
            <figure
              key={i}
              className="my-2 overflow-hidden rounded-2xl border border-line bg-surface/40"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={alt || "Blog görseli"}
                className="max-h-[460px] w-full object-cover"
              />
              {alt ? (
                <figcaption className="border-t border-line/60 px-4 py-2 text-center text-xs text-fg-passive">
                  {alt}
                </figcaption>
              ) : null}
            </figure>
          );
        }

        if (trimmed.startsWith("### ")) {
          return (
            <h3 key={i} className="mt-3 text-lg font-semibold tracking-tight text-fg">
              {renderInline(trimmed.slice(4), onTagClick)}
            </h3>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <h2
              key={i}
              className="mt-5 border-b border-line/70 pb-2 text-2xl font-semibold tracking-tight text-fg"
            >
              {renderInline(trimmed.slice(3), onTagClick)}
            </h2>
          );
        }
        if (trimmed.startsWith("# ")) {
          return (
            <h2
              key={i}
              className="mt-5 border-b border-line/70 pb-2 text-2xl font-semibold tracking-tight text-fg"
            >
              {renderInline(trimmed.slice(2), onTagClick)}
            </h2>
          );
        }

        const lines = trimmed.split("\n").map((l) => l.trim());
        if (lines.every((l) => l.startsWith("> "))) {
          return (
            <blockquote
              key={i}
              className="rounded-r-2xl border-l-4 border-neon-pink/60 bg-surface/60 px-5 py-3.5 text-[15px] leading-relaxed text-fg"
            >
              {lines.map((l, j) => (
                <p key={j}>{renderInline(l.slice(2), onTagClick)}</p>
              ))}
            </blockquote>
          );
        }

        if (lines.every((l) => l.startsWith("- ") || l.startsWith("* "))) {
          return (
            <ul key={i} className="list-disc space-y-2.5 pl-6 marker:text-neon-pink">
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.slice(2), onTagClick)}</li>
              ))}
            </ul>
          );
        }

        if (lines.every((l) => /^\d+\.\s+/.test(l))) {
          return (
            <ol key={i} className="list-decimal space-y-2.5 pl-6 marker:font-semibold marker:text-fg">
              {lines.map((l, j) => (
                <li key={j}>{renderInline(l.replace(/^\d+\.\s+/, ""), onTagClick)}</li>
              ))}
            </ol>
          );
        }

        return <p key={i}>{renderInline(trimmed.replace(/\n/g, " "), onTagClick)}</p>;
      })}
    </div>
  );
}
