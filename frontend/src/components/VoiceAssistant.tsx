"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { PaperAirplaneIcon, MicrophoneIcon } from "@heroicons/react/24/solid";

// ─── Types ────────────────────────────────────────────────────────────────────
type State = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

interface Message {
    id: string;
    role: "user" | "ai";
    text: string;
    timestamp: Date;
}

interface VoiceQAProps {
    fileId: string;
    documentTitle?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const STATE_LABELS: Record<State, string> = {
    idle: "Ask anything about this medical record",
    connecting: "Connecting...",
    listening: "Listening...",
    thinking: "Finding answer...",
    speaking: "Speaking...",
    error: "Something went wrong",
};

const STATE_COLORS: Record<State, string> = {
    idle: "#3a3a4a",
    connecting: "#f0c93a",
    listening: "#3affa0",
    thinking: "#3ab8ff",
    speaking: "#b57aff",
    error: "#ff5f5f",
};

// ─── Waveform Visualizer ──────────────────────────────────────────────────────
function Waveform({ active, color }: { active: boolean; color: string }) {
    const bars = 20;
    return (
        <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 3,
            height: 40,
        }}>
            {Array.from({ length: bars }).map((_, i) => (
                <div
                    key={i}
                    style={{
                        width: 3,
                        borderRadius: 2,
                        background: color,
                        height: active
                            ? `${20 + Math.sin(Date.now() / 200 + i * 0.5) * 15}px`
                            : 4,
                        opacity: active ? 0.7 + (i % 3) * 0.1 : 0.2,
                        transition: active
                            ? `height ${100 + i * 20}ms ease-in-out`
                            : "height 0.3s ease, opacity 0.3s ease",
                        animation: active ? `wave-${i % 5} ${0.8 + (i % 4) * 0.2}s ease-in-out infinite alternate` : "none",
                    }}
                />
            ))}
            <style>{`
        @keyframes wave-0 { from { height: 6px } to { height: 32px } }
        @keyframes wave-1 { from { height: 14px } to { height: 26px } }
        @keyframes wave-2 { from { height: 8px } to { height: 38px } }
        @keyframes wave-3 { from { height: 18px } to { height: 22px } }
        @keyframes wave-4 { from { height: 4px } to { height: 30px } }
      `}</style>
        </div>
    );
}

// ─── Mic Button ───────────────────────────────────────────────────────────────
function MicButton({
    state,
    onClick,
}: {
    state: State;
    onClick: () => void;
}) {
    const isActive = state === "listening";
    const isDisabled = state === "connecting" || state === "thinking" || state === "speaking";
    const color = STATE_COLORS[state];

    return (
        <button
            onClick={onClick}
            disabled={isDisabled}
            style={{
                position: "relative",
                width: 72,
                height: 72,
                borderRadius: "50%",
                border: `2px solid ${color}`,
                background: isActive ? color : "transparent",
                cursor: isDisabled ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.3s ease",
                opacity: isDisabled ? 0.5 : 1,
                flexShrink: 0,
            }}
        >
            {/* Pulse ring */}
            {isActive && (
                <div style={{
                    position: "absolute",
                    inset: -8,
                    borderRadius: "50%",
                    border: `2px solid ${color}`,
                    opacity: 0.4,
                    animation: "pulse-ring 1.5s ease-out infinite",
                }} />
            )}

            {/* Icon */}
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                {state === "thinking" || state === "speaking" ? (
                    // Stop icon
                    <rect x="6" y="6" width="12" height="12" rx="2"
                        fill={isActive ? "#0a0a0b" : color} />
                ) : (
                    // Mic icon
                    <>
                        <rect x="9" y="2" width="6" height="12" rx="3"
                            fill={isActive ? "#0a0a0b" : color} />
                        <path d="M5 10a7 7 0 0 0 14 0" stroke={isActive ? "#0a0a0b" : color}
                            strokeWidth="2" strokeLinecap="round" />
                        <line x1="12" y1="17" x2="12" y2="21"
                            stroke={isActive ? "#0a0a0b" : color} strokeWidth="2" strokeLinecap="round" />
                        <line x1="9" y1="21" x2="15" y2="21"
                            stroke={isActive ? "#0a0a0b" : color} strokeWidth="2" strokeLinecap="round" />
                    </>
                )}
            </svg>

            <style>{`
        @keyframes pulse-ring {
          0%   { transform: scale(1); opacity: 0.4; }
          100% { transform: scale(1.4); opacity: 0; }
        }
      `}</style>
        </button>
    );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────
function MessageBubble({ message }: { message: Message }) {
    const isUser = message.role === "user";
    return (
        <div style={{
            display: "flex",
            justifyContent: isUser ? "flex-end" : "flex-start",
            marginBottom: 12,
            animation: "fadeUp 0.3s ease both",
        }}>
            <div style={{
                maxWidth: "80%",
                padding: "10px 16px",
                borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                background: isUser ? "rgba(58,255,160,0.1)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${isUser ? "rgba(58,255,160,0.2)" : "rgba(255,255,255,0.08)"}`,
            }}>
                <p style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: isUser ? "#3affa0" : "#e2e2ee",
                    margin: 0,
                }}>
                    {message.text}
                </p>
                <p style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 10,
                    color: "rgba(255,255,255,0.2)",
                    margin: "6px 0 0",
                    textAlign: isUser ? "right" : "left",
                }}>
                    {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
            </div>
            <style>{`@keyframes fadeUp { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }`}</style>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function VoiceQA({ fileId, documentTitle }: VoiceQAProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [state, setState] = useState<State>("idle");
    const [messages, setMessages] = useState<Message[]>([]);
    const [errorMsg, setErrorMsg] = useState<string>("");

    useEffect(() => {
        const handleOpen = () => setIsOpen(true);
        window.addEventListener('open-voice-assistant', handleOpen);
        return () => window.removeEventListener('open-voice-assistant', handleOpen);
    }, []);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const recognitionRef = useRef<any>(null); // Use existing WebSpeech for transcription

    // Auto-scroll messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const addMessage = useCallback((role: "user" | "ai", text: string) => {
        setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role,
            text,
            timestamp: new Date(),
        }]);
    }, []);

    const handleAskAI = async (question: string) => {
        if (!question.trim()) return;

        setState("thinking");
        try {
            const res = await fetch(`/api/ai/ask`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, fileId })
            });
            const data = await res.json();

            if (data.error) throw new Error(data.error);

            addMessage("ai", data.answer);
            setState("speaking");

            if (data.audio) {
                console.log(`[VoiceAssistant] Playing audio from Gemini TTS service`);
                const audio = new Audio(`data:${data.mimeType};base64,${data.audio}`);
                audioRef.current = audio;
                audio.onended = () => {
                    setState("idle");
                };
                await audio.play();
            } else if (data.answer) {
                // Fallback to Browser Text-to-Speech
                console.log(`[VoiceAssistant] Using Browser TTS (Fallback)`);
                const utterance = new SpeechSynthesisUtterance(data.answer);

                // Try to find a high-quality Google US voice
                const voices = window.speechSynthesis.getVoices();
                const googleVoice = voices.find(v => v.name.includes('Google US English') || v.name.includes('en-US'));
                if (googleVoice) utterance.voice = googleVoice;

                utterance.onend = () => setState("idle");
                utterance.onerror = () => setState("idle");
                window.speechSynthesis.speak(utterance);
            } else {
                setState("idle");
            }
        } catch (err: any) {
            console.error(err);
            setErrorMsg(err.message || "Failed to get AI response");
            setState("error");

            // Final fallback: if we have any text, try to speak it? 
            // Usually we don't have text here because the error happened before.
        }
    };

    const startListening = useCallback(async () => {
        try {
            setErrorMsg("");
            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

            if (!SpeechRecognition) {
                throw new Error("Speech recognition not supported in this browser.");
            }

            const recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onstart = () => {
                setState("listening");
            };

            recognition.onresult = (event: any) => {
                const lastResultIndex = event.results.length - 1;
                const text = event.results[lastResultIndex][0].transcript;
                if (event.results[lastResultIndex].isFinal) {
                    addMessage("user", text);
                    handleAskAI(text);
                    recognition.stop();
                }
            };

            recognition.onend = () => {
                if (state === "listening") setState("idle");
            };

            recognition.onerror = (event: any) => {
                console.error("Speech Error:", event.error);
                if (event.error !== 'no-speech') {
                    setErrorMsg(`Mic Error: ${event.error}`);
                    setState("error");
                } else {
                    setState("idle");
                }
            };

            recognitionRef.current = recognition;
            recognition.start();

        } catch (err: any) {
            setErrorMsg(err.message || "Microphone access denied");
            setState("error");
        }
    }, [fileId, addMessage, state]);

    const stopEverything = useCallback(() => {
        recognitionRef.current?.stop();
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }
        // Also stop browser TTS fallback
        if (typeof window !== "undefined" && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        setState("idle");
    }, []);

    const handleToggle = useCallback(() => {
        if (state === "idle" || state === "error") {
            startListening();
        } else {
            stopEverything();
        }
    }, [state, startListening, stopEverything]);

    // Cleanup on unmount
    useEffect(() => () => stopEverything(), [stopEverything]);

    const color = STATE_COLORS[state];
    const isActive = state !== "idle" && state !== "error";

    return (
        <div className="fixed bottom-4 sm:bottom-6 right-4 sm:right-6 z-50 flex flex-col items-end max-w-[calc(100vw-32px)]">
            {isOpen ? (
                <div style={{
                    fontFamily: "'Cabinet Grotesk', sans-serif",
                    background: "#0a0a0d",
                    border: "1px solid #1e1e2a",
                    borderRadius: 24,
                    overflow: "hidden",
                    width: "100%",
                    maxWidth: 420,
                    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 10px 10px -5px rgba(0, 0, 0, 0.5)",
                    animation: "panel-reveal 0.4s cubic-bezier(0.16, 1, 0.3, 1)"
                }}>
                    <style>{`
            @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Cabinet+Grotesk:wght@400;500;700;800&display=swap');
            @keyframes panel-reveal {
              from { opacity: 0; transform: translateY(20px) scale(0.95); }
              to { opacity: 1; transform: translateY(0) scale(1); }
            }
          `}</style>

                    {/* Header */}
                    <div style={{
                        padding: "16px 20px",
                        borderBottom: "1px solid #1e1e2a",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "rgba(255,255,255,0.02)"
                    }}>
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-blue-600/20 rounded-lg flex items-center justify-center border border-blue-500/20">
                                <MicrophoneIcon className="w-4 h-4 text-blue-400" />
                            </div>
                            <div>
                                <p style={{ fontSize: 13, fontWeight: 700, margin: 0, letterSpacing: "-0.01em", color: "#fff" }}>
                                    Clinical AI Assistant
                                </p>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, animation: isActive ? "blink 1.2s ease-in-out infinite" : "none" }} />
                                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                                        {state}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => setIsOpen(false)}
                            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-slate-400 transition-colors"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>

                    {/* Messages */}
                    <div style={{
                        height: 320,
                        overflowY: "auto",
                        padding: "20px",
                        scrollbarWidth: "none",
                        display: "flex",
                        flexDirection: "column"
                    }}>
                        {messages.length === 0 ? (
                            <div style={{
                                flex: 1,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 12,
                                opacity: 0.5,
                                textAlign: "center"
                            }}>
                                <div className="w-16 h-16 bg-blue-600/10 rounded-3xl flex items-center justify-center border border-blue-500/10 mb-2">
                                    <span style={{ fontSize: 32 }}>🏥</span>
                                </div>
                                <p style={{
                                    fontFamily: "'DM Mono', monospace",
                                    fontSize: 12,
                                    color: "#e2e2ee",
                                    lineHeight: 1.6,
                                }}>
                                    How can I help you understand<br />this medical document today?
                                </p>
                                <p style={{ fontSize: 10, color: "#5a5a72" }}>Try: "What are the main risks?" or "Summarize the lab results."</p>
                            </div>
                        ) : (
                            messages.map(m => <MessageBubble key={m.id} message={m} />)
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Controls */}
                    <div style={{
                        padding: "16px 20px 24px",
                        borderTop: "1px solid #1e1e2a",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 16,
                        background: "rgba(0,0,0,0.2)"
                    }}>
                        {/* Waveform */}
                        <Waveform
                            active={state === "listening" || state === "speaking"}
                            color={color}
                        />

                        {/* Mic button + label */}
                        <div style={{ display: "flex", alignItems: "center", gap: 20, width: "100%" }}>
                            <MicButton state={state} onClick={handleToggle} />
                            <div style={{ flex: 1 }}>
                                <p style={{
                                    fontSize: 14,
                                    fontWeight: 600,
                                    margin: "0 0 2px",
                                    color: "#fff",
                                    transition: "color 0.3s",
                                }}>
                                    {STATE_LABELS[state]}
                                </p>
                                {errorMsg ? (
                                    <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#ff595e", margin: 0 }}>
                                        {errorMsg}
                                    </p>
                                ) : (
                                    <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#5a5a72", margin: 0 }}>
                                        {state === "listening" ? "Listening..." : "Click mic to speak"}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Manual Input Fallback */}
                        <div style={{ display: "flex", width: "100%", gap: 8, marginTop: 4 }}>
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    const input = (e.currentTarget.elements.namedItem('question') as HTMLInputElement).value;
                                    if (input) {
                                        addMessage("user", input);
                                        handleAskAI(input);
                                        e.currentTarget.reset();
                                    }
                                }}
                                style={{ display: "flex", width: "100%", gap: 8 }}
                            >
                                <input
                                    name="question"
                                    type="text"
                                    placeholder="Or type your question here..."
                                    style={{
                                        flex: 1,
                                        background: "rgba(255,255,255,0.03)",
                                        border: "1px solid #1e1e2a",
                                        borderRadius: 12,
                                        padding: "8px 14px",
                                        fontSize: 13,
                                        color: "#fff",
                                        outline: "none"
                                    }}
                                />
                                <button
                                    type="submit"
                                    style={{
                                        background: "#3ab8ff",
                                        color: "#0a0a0d",
                                        border: "none",
                                        borderRadius: 12,
                                        width: 38,
                                        height: 38,
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        transition: "all 0.2s"
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.transform = "scale(1.05)"}
                                    onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                                >
                                    <PaperAirplaneIcon style={{ width: 16, height: 16 }} />
                                </button>
                            </form>
                        </div>
                    </div>

                    <style>{`
            @keyframes blink {
              0%, 100% { opacity: 1; }
              50%       { opacity: 0.3; }
            }
            div::-webkit-scrollbar { display: none; }
          `}</style>
                </div>
            ) : (
                /* Floating Activation Button */
                <button
                    onClick={() => setIsOpen(true)}
                    className="group relative h-16 w-16 bg-blue-600 text-white rounded-full shadow-2xl shadow-blue-500/40 flex items-center justify-center hover:bg-blue-700 hover:scale-110 active:scale-95 transition-all duration-300 ring-4 ring-white"
                >
                    <div className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-20 group-hover:block hidden"></div>
                    <MicrophoneIcon className="w-8 h-8" />

                    {/* Tooltip */}
                    <div className="absolute right-20 bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest py-2 px-4 rounded-xl opacity-0 group-hover:opacity-100 transition-all transform group-hover:translate-x-0 translate-x-4 whitespace-nowrap pointer-events-none shadow-2xl border border-white/10">
                        Ask Clinical AI
                    </div>
                </button>
            )}
        </div>
    );
}
