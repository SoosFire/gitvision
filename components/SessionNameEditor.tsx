"use client";

// Inline editable session title. Click to rename, Enter to commit, Escape to cancel.
// Extracted from the old SessionToolbar so the new toolbar stays focused on actions.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TOK } from "@/lib/theme";

export function SessionNameEditor({
  sessionId,
  initialName,
}: {
  sessionId: string;
  initialName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);

  async function commit() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === initialName) {
      setEditing(false);
      setName(initialName);
      return;
    }
    await fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setEditing(false);
            setName(initialName);
          }
        }}
        className="text-3xl font-semibold tracking-tight bg-transparent focus:outline-none"
        style={{
          color: TOK.textPrimary,
          letterSpacing: "-0.02em",
          borderBottom: `1px solid ${TOK.borderStrong}`,
        }}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-3xl font-semibold tracking-tight transition hover:opacity-80"
      style={{
        color: TOK.textPrimary,
        letterSpacing: "-0.02em",
      }}
      title="Click to rename"
    >
      {initialName}
    </button>
  );
}
