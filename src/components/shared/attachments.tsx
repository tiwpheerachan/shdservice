"use client";

import * as React from "react";
import { Paperclip, Trash2, Upload, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Row = { id: number; name: string; note: string };

export function Attachments() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [name, setName] = React.useState("");
  const [note, setNote] = React.useState("");
  const idRef = React.useRef(0);

  const add = () => {
    if (!name.trim()) return;
    setRows((r) => [...r, { id: ++idRef.current, name: name.trim(), note }]);
    setName("");
    setNote("");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
          <Upload className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {name || "เลือกไฟล์แนบ (PDF, JPG, PNG — ไม่เกิน 10MB)"}
          </span>
          <input
            type="file"
            className="hidden"
            onChange={(e) => setName(e.target.files?.[0]?.name ?? "")}
          />
        </label>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="คำอธิบายเพิ่มเติม"
          className="sm:w-64"
        />
        <Button variant="outline" size="md" onClick={add} disabled={!name}>
          <Paperclip className="h-3.5 w-3.5" />
          แนบไฟล์
        </Button>
      </div>

      <div className="table-scroll border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
              <th className="w-10 px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">เอกสารแนบ</th>
              <th className="px-3 py-2 text-left">คำอธิบายเพิ่มเติม</th>
              <th className="w-20 px-3 py-2 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  ยังไม่มีเอกสารแนบ
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.id} className="border-b border-border/70 last:border-0">
                  <td className="num px-3 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-primary" />
                      {r.name}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.note || "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => setRows((s) => s.filter((x) => x.id !== r.id))}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger"
                      aria-label="ลบ"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
