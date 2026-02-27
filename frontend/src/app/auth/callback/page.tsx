'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function AuthCallback() {
    useEffect(() => {
        const handleAuth = async () => {
            // Small delay to ensure Supabase has parsed the URL fragment
            // and established the session in localStorage
            const { data } = await supabase.auth.getSession();
            console.log('Session established:', !!data.session);

            await new Promise(resolve => setTimeout(resolve, 500));

            if (window.opener) {
                try {
                    // Notify the main tab to refresh
                    window.opener.location.reload();
                    window.close();
                } catch (e) {
                    // Fallback if opener is inaccessible
                    if (data.session?.user?.id) {
                        window.location.href = `/dashboard/${data.session.user.id}`;
                    } else {
                        window.location.href = '/';
                    }
                }
            } else {
                if (data.session?.user?.id) {
                    window.location.href = `/dashboard/${data.session.user.id}`;
                } else {
                    window.location.href = '/';
                }
            }
        };

        handleAuth();
    }, []);

    return (
        <div className="min-h-[100dvh] bg-black flex items-center justify-center">
            <div className="text-center space-y-4">
                <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-cyan-400/50 text-[10px] uppercase tracking-[0.3em] font-black">
                    Authenticating Clinical Profile...
                </p>
            </div>
        </div>
    );
}
