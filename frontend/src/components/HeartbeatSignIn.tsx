'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function HeartbeatSignIn() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isClicked, setIsClicked] = useState(false);
    const [statusText, setStatusText] = useState('Identity Validation Required');

    const mousePos = useRef({ x: -1000, y: -1000 });
    const intensityRef = useRef(0);
    const timeRef = useRef(0);
    const lastUpdateRef = useRef(Date.now());
    const animationRef = useRef<number>(0);

    // Listen for Auth State changes (Redundant but safe backup for the popup callback)
    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session) {
                // If we detect a session has been established (via popup or otherwise),
                // refresh the main root to show the dashboard.
                window.location.reload();
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const handleResize = () => {
            if (!canvas || !canvas.parentElement) return;
            canvas.width = canvas.parentElement.offsetWidth * window.devicePixelRatio;
            canvas.height = canvas.parentElement.offsetHeight * window.devicePixelRatio;
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        };

        window.addEventListener('resize', handleResize);
        handleResize();

        const handleMouseMove = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            mousePos.current = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
            };
        };

        window.addEventListener('mousemove', handleMouseMove, { passive: true });

        const drawLoop = () => {
            const now = Date.now();
            const dt = (now - lastUpdateRef.current) / 1000;
            lastUpdateRef.current = now;

            // Speed stays active during click
            const speedFactor = 0.5 + intensityRef.current * (isClicked ? 2.8 : 0.85);
            timeRef.current += dt * speedFactor * 1.2;
            const t = timeRef.current;

            const width = canvas.width / window.devicePixelRatio;
            const height = canvas.height / window.devicePixelRatio;

            const centerX = width / 2;
            const monitorY = height * 0.5;
            const buttonY = monitorY + 180;

            const dx = mousePos.current.x - centerX;
            const dy = mousePos.current.y - buttonY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            const targetIntensity = isClicked ? 1.0 : Math.pow(Math.max(0, 1 - dist / 800), 2);
            intensityRef.current += (targetIntensity - intensityRef.current) * 0.05;

            const intensity = intensityRef.current;

            ctx.clearRect(0, 0, width, height);

            // Medical Grid
            ctx.beginPath();
            ctx.strokeStyle = `rgba(34, 211, 238, ${0.03 + intensity * 0.06})`;
            ctx.lineWidth = 0.5;
            for (let i = 0; i < width; i += 40) { ctx.moveTo(i, 0); ctx.lineTo(i, height); }
            for (let i = 0; i < height; i += 40) { ctx.moveTo(0, i); ctx.lineTo(width, i); }
            ctx.stroke();

            // Line Logic
            ctx.beginPath();
            const alpha = 0.15 + intensity * 0.85;
            ctx.strokeStyle = `rgba(34, 211, 238, ${alpha})`;
            ctx.lineWidth = 2 + intensity * 0.6;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';

            ctx.shadowBlur = 4 + intensity * 24;
            ctx.shadowColor = 'rgba(34, 211, 238, 0.8)';

            ctx.moveTo(0, monitorY);
            const step = 0.6;

            for (let x = 0; x <= width; x += step) {
                let y = monitorY;
                let cycle = ((x / 180 - t) % 1 + 1) % 1;
                let wave = 0;

                if (cycle > 0.05 && cycle < 0.15) wave -= Math.sin((cycle - 0.05) * Math.PI * 10) * 3;
                else if (cycle > 0.22 && cycle < 0.32) {
                    const localX = (cycle - 0.22) * 10;
                    if (localX < 0.1) wave += localX * 20;
                    else if (localX < 0.5) wave -= (localX - 0.1) * 200;
                    else wave += (localX - 0.5) * 160;
                }
                else if (cycle > 0.5 && cycle < 0.72) wave -= Math.sin((cycle - 0.5) * Math.PI * 4.5) * 8;

                wave += (Math.random() - 0.5) * (1.0 + intensity * 2);

                const surgeMultiplier = isClicked ? 1.6 : 1.0;
                y += wave * (0.05 + intensity * 0.95) * surgeMultiplier;

                ctx.lineTo(x, y);
            }
            ctx.stroke();

            const scanX = (t * 140) % width;
            const grad = ctx.createLinearGradient(scanX - 60, 0, scanX + 60, 0);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
            grad.addColorStop(0.5, `rgba(255, 255, 255, ${0.05 + intensity * 0.3})`);
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = grad;
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillRect(scanX - 60, 0, 120, height);
            ctx.globalCompositeOperation = 'source-over';

            animationRef.current = requestAnimationFrame(drawLoop);
        };

        animationRef.current = requestAnimationFrame(drawLoop);

        return () => {
            cancelAnimationFrame(animationRef.current);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, [isClicked]);

    const handleSignIn = async () => {
        setIsClicked(true);
        setStatusText('Awaiting Authentication...');

        // Stage 1: Get the OAuth URL immediately
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
                skipBrowserRedirect: true,
            },
        });

        if (error || !data.url) {
            console.error('Sign in error:', error);
            setIsClicked(false);
            setStatusText('Identity Validation Required');
            return;
        }

        // Stage 2: Open Popup Immediately (to avoid blockers)
        const width = 600;
        const height = 740;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        const popup = window.open(
            data.url,
            'google-login',
            `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes,toolbar=no,menubar=no,location=no`
        );

        if (!popup) {
            alert('Please enable popups to continue with the Clinical Sign In.');
            setIsClicked(false);
            setStatusText('Identity Validation Required');
        }
    };

    return (
        <div
            ref={containerRef}
            className="relative w-full max-w-2xl mx-auto flex flex-col items-center pt-8"
        >
            {/* The Monitor Area */}
            <div className="relative w-full aspect-[21/9] bg-black/40 backdrop-blur-md rounded-[2.5rem] border border-white/5 overflow-hidden shadow-2xl group mb-12">
                <div className="absolute inset-0 bg-blue-500/5 transition-opacity duration-1000 group-hover:opacity-10 pointer-events-none" />
                <canvas
                    ref={canvasRef}
                    className="w-full h-full pointer-events-none"
                    style={{ opacity: 0.98 }}
                />
                <div className="absolute inset-0 pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-overlay" />
                <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_100px_rgba(0,0,0,0.8)]" />
                <div className="absolute inset-0 pointer-events-none opacity-20 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.15)_50%)] bg-[length:100%_4px]" />

                <div className="absolute top-6 left-8 flex items-center space-x-3 opacity-30 select-none">
                    <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse" />
                    <span className="text-[8px] font-black tracking-[0.4em] text-cyan-500 uppercase">Live Telemetry</span>
                </div>
                <div className="absolute bottom-6 right-8 opacity-20 select-none">
                    <span className="text-[7px] font-bold tracking-[0.2em] text-white uppercase">ID: MED-SYS-PROTO</span>
                </div>
            </div>

            {/* Verification Content */}
            <div className="relative flex flex-col items-center w-full min-h-[140px]">
                <div className={`text-center mb-8 transition-all duration-700 ${isClicked ? 'translate-y-4' : 'translate-y-0'}`}>
                    <p className={`text-[10px] font-black uppercase tracking-[0.5em] transition-colors duration-500 ${isClicked ? 'text-cyan-400' : 'text-white/40'}`}>
                        {statusText}
                    </p>
                    <p className={`text-[9px] font-medium max-w-[280px] leading-relaxed mx-auto italic transition-all duration-700 ${isClicked ? 'opacity-100 text-cyan-400/50' : 'opacity-40 text-white/20'}`}>
                        {isClicked ? 'Waiting for clinical authentication in the secure window. Please complete login there.' : 'Securing clinical infrastructure. Please authenticate to proceed.'}
                    </p>
                </div>

                {!isClicked ? (
                    <button
                        onClick={handleSignIn}
                        className="group relative flex items-center bg-white text-black pl-10 pr-4 py-4 rounded-[1.5rem] transition-all duration-500 hover:scale-[1.03] active:scale-95 shadow-[0_25px_60px_-15px_rgba(255,255,255,0.15)] border border-white hover:bg-zinc-50 overflow-hidden"
                    >
                        <div className="flex flex-col items-start leading-tight mr-10">
                            <span className="text-[8px] text-zinc-400 font-black uppercase tracking-[0.2em] mb-1">Verify as Provider</span>
                            <span className="text-base font-black tracking-tighter uppercase whitespace-nowrap">Clinical Login</span>
                        </div>
                        <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-[inset_0_0_10px_rgba(0,0,0,0.05)] border border-zinc-100 transition-colors group-hover:border-zinc-200">
                            <svg className="w-6 h-6" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                            </svg>
                        </div>
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/5 to-transparent -translate-x-full group-hover:animate-[shine_2s_infinite] transition-transform" />
                    </button>
                ) : (
                    <div className="flex items-center justify-center p-6 scale-150">
                        <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                )}
            </div>
        </div>
    );
}
