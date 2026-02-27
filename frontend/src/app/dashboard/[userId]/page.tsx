'use client';

import { Suspense, use } from 'react';
import { HomeContent } from '../../page';

interface PageProps {
    params: Promise<{
        userId: string;
    }>;
}

export default function DashboardPage({ params }: PageProps) {
    const { userId } = use(params);

    // We can use the HomeContent component, it will handle getting the session
    // and fetching documents for that user.
    return (
        <Suspense fallback={
            <main className="min-h-[100dvh] bg-black flex items-center justify-center">
                <div className="w-10 h-10 border-4 border-white/5 border-t-blue-500 rounded-full animate-spin"></div>
            </main>
        }>
            <HomeContent />
        </Suspense>
    );
}
