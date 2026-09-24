// src/views/grid/EditableCell.tsx
//
// Editable cell for the grid. Holds a local draft value and commits on
// blur or Enter. Escape reverts.
//
// Two variants: text (string) and number. Number cells reject non-finite
// input on commit.

import { useEffect, useRef, useState } from "react";

interface BaseProps {
  readonly value: string | number | undefined;
  readonly onCommit: (next: string) => void;
  readonly align?: "left" | "right";
  readonly width?: number | string;
  readonly placeholder?: string;
}

export function EditableTextCell(props: BaseProps) {
  return <EditableRaw {...props} kind="text" />;
}

export function EditableNumberCell(props: BaseProps) {
  return <EditableRaw {...props} kind="number" />;
}

function EditableRaw({
  value,
  onCommit,
  align = "left",
  width,
  placeholder,
  kind,
}: BaseProps & { kind: "text" | "number" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const display = value === undefined ? "" : String(value);

  function startEditing() {
    setDraft(display);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    if (draft === display) return;

    if (kind === "number") {
      const n = Number(draft.trim());
      if (!Number.isFinite(n)) return; // revert silently
      onCommit(String(n));
      return;
    }
    onCommit(draft);
  }

  function cancel() {
    setEditing(false);
    setDraft("");
  }

  if (!editing) {
    return (
      <div
        onClick={startEditing}
        title={display}
        style={{
          padding: "4px 8px",
          textAlign: align,
          cursor: "text",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          width,
          color: value === undefined ? "#999" : "inherit",
        }}
      >
        {display || (placeholder ?? "")}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      style={{
        padding: "4px 8px",
        textAlign: align,
        border: "1px solid #4a9eff",
        borderRadius: 2,
        outline: "none",
        width: "100%",
        boxSizing: "border-box",
        font: "inherit",
        background: "#fff",
        color: "#000",
      }}
    />
  );
}