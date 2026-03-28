"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { formatTranscriptTool } from "./cards/CardRouter";

type StreamAPI = {
  sendStreamPrompt: (t: string) => void;
  cancelStream: () => void;
  endStreamSession: () => void;
  onStreamEvent: (cb: (d: { type: string; content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[]; tokens?: { input: number; output: number; cacheRead: number; cacheCreation: number }; model?: string; totalCost?: number; durationMs?: number; isError?: boolean; result?: string; exitCode?: number; status?: string; resetsAt?: string }) => void) => void;
  removeStreamEvent: () => void;
  onFocusInput: (cb: () => void) => void;
  removeFocusInput: () => void;
};

export const CommandBar = React.memo(function CommandBar({ onRateLimit }: { onRateLimit?: (data: { status: string; resetsAt: string }) => void }) {
  const [input, setInput] = useState("");
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState<"none" | "working" | "error">("none");
  const [sessionActive, setSessionActive] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const getApi = () => (window as unknown as Record<string, StreamAPI>).electronAPI;

  useEffect(() => {
    const api = getApi();
    if (!api) return;

    api.onFocusInput(() => { inputRef.current?.focus(); });

    api.onStreamEvent((msg) => {
      if (msg.type === "init") {
        setSessionActive(true);
      } else if (msg.type === "assistant" && msg.content) {
        setStatus("working");
        for (const block of msg.content) {
          if (block.type === "text" && block.text) {
            setTranscript(prev => prev + block.text);
          }
          if (block.type === "tool_use") {
            setTranscript(prev => prev + `\n${formatTranscriptTool(block.name || "Tool", (block.input || {}) as Record<string, unknown>)}\n`);
          }
        }
      } else if (msg.type === "result") {
        if (msg.isError) {
          setStatus("error");
          setTranscript(prev => prev + `\nError: ${msg.result || "Unknown error"}\n`);
        }
        setSessionActive(true);
      } else if (msg.type === "done") {
        setStatus("none");
        inputRef.current?.focus();
      } else if (msg.type === "rateLimit") {
        onRateLimit?.({ status: msg.status || "unknown", resetsAt: msg.resetsAt || "" });
      }
    });

    return () => {
      api.removeStreamEvent();
      api.removeFocusInput();
    };
  }, []);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const resizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 300) + "px";
  }, []);

  useEffect(() => { resizeTextarea(); }, [input, resizeTextarea]);

  const send = () => {
    const text = input.trim();
    if (!text || status === "working") return;
    const api = getApi();
    if (!api) return;
    setTranscript(prev => prev + (prev ? "\n" : "") + "> " + text + "\n");
    setStatus("working");
    api.sendStreamPrompt(text);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  };

  const cancel = () => {
    const api = getApi();
    if (!api) return;
    api.cancelStream();
  };

  const endSession = () => {
    const api = getApi();
    if (!api) return;
    api.endStreamSession();
    setTranscript("");
    setSessionActive(false);
  };

  const isWorking = status === "working";

  return (
    <div className={`no-drag shrink-0 border-t border-white/[0.08] transition-all duration-300 ${isWorking ? "cmd-thinking" : ""}`} style={{ background: "rgba(0, 0, 0, 0.40)", backdropFilter: "blur(24px) saturate(150%)" }}>
      {transcript && (
        <div ref={transcriptRef} className="px-3 pt-2 pb-1 max-h-[150px] overflow-y-auto">
          <pre className="text-[9px] font-mono text-indigo-200/70 leading-relaxed whitespace-pre-wrap break-words">{transcript}</pre>
        </div>
      )}
      <div className="flex items-end gap-2 px-3 py-2">
        <div className="flex items-center gap-1.5 shrink-0 self-center">
          <div className={`w-2 h-2 rounded-full ${isWorking ? "bg-cyan-400 animate-pulse" : status === "error" ? "bg-red-400" : sessionActive ? "bg-green-400" : "bg-white/20"}`} />
          <span className="text-[7px] font-mono text-txt-tertiary w-[40px]">{isWorking ? "Stream" : sessionActive ? "Ready" : "Idle"}</span>
        </div>
        <div className="relative flex-1">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              if (e.key === "Escape") { if (isWorking) cancel(); else inputRef.current?.blur(); }
            }}
            placeholder={isWorking ? "Streaming..." : "Send a prompt...   Ctrl+K"}
            className="w-full px-3 py-1.5 rounded-lg text-[10px] font-mono text-txt-secondary placeholder:text-txt-tertiary outline-none transition-all focus:ring-1 focus:ring-indigo-500/30 resize-none overflow-hidden"
            style={{ background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.06)" }}
          />
          {isWorking && (
            <div className="absolute right-2.5 bottom-2">
              <div className="w-3 h-3 rounded-full border border-cyan-400/50 border-t-cyan-400 animate-spin" />
            </div>
          )}
        </div>
        {isWorking ? (
          <button onClick={cancel} className="px-3 py-1.5 rounded-lg transition-all"
            style={{ background: "rgba(239, 68, 68, 0.20)", border: "1px solid rgba(239, 68, 68, 0.15)", color: "rgba(252, 165, 165, 0.9)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </button>
        ) : (
          <button onClick={send} disabled={!input.trim()}
            className="px-3 py-1.5 rounded-lg transition-all disabled:opacity-30"
            style={{ background: "rgba(99, 102, 241, 0.20)", border: "1px solid rgba(99, 102, 241, 0.15)", color: "rgba(165, 180, 252, 0.9)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
        {sessionActive && (
          <button onClick={endSession} title="End session"
            className="px-2 py-1.5 rounded-lg transition-all text-txt-tertiary/50 hover:text-red-400/80"
            style={{ background: "transparent", border: "1px solid rgba(255, 255, 255, 0.04)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18.36 6.64A9 9 0 1 1 5.64 5.64" /><line x1="12" y1="2" x2="12" y2="12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});
