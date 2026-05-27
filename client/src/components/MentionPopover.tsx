import { cn } from "@/lib/utils";

interface MentionPopoverProps {
  query: string;
  people: string[];
  activeIndex: number;
  onSelect: (name: string) => void;
  onHover: (index: number) => void;
}

export function MentionPopover({ query, people, activeIndex, onSelect, onHover }: MentionPopoverProps) {
  if (people.length === 0 && query === "") return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-[var(--color-card)] border border-[var(--color-border)] rounded-md shadow-lg z-50 overflow-hidden">
      <div className="px-2.5 py-1 border-b border-[var(--color-border)]">
        <span className="text-[10px] font-mono text-[var(--color-muted-foreground)] uppercase tracking-widest">
          {query ? `@${query}` : "mencionar pessoa"}
        </span>
      </div>
      {people.length > 0 ? (
        <div className="py-0.5 max-h-44 overflow-y-auto">
          {people.map((person, i) => (
            <button
              key={person}
              className={cn(
                "w-full text-left px-2.5 py-1 text-[13px] font-mono transition-colors",
                i === activeIndex
                  ? "bg-[var(--color-muted)] text-[var(--color-foreground)]"
                  : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              )}
              onMouseDown={(e) => { e.preventDefault(); onSelect(person); }}
              onMouseEnter={() => onHover(i)}
            >
              <span className="opacity-40">@</span>{person}
            </button>
          ))}
        </div>
      ) : (
        <div className="px-2.5 py-2 text-[12px] font-mono text-[var(--color-muted-foreground)]">
          espaço para criar <span className="text-[var(--color-foreground)]">@{query}</span>
        </div>
      )}
    </div>
  );
}
