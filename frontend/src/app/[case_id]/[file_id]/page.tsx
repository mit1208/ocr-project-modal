'use client';

import { Suspense, use } from 'react';
import { HomeContent } from '../../page';

interface PageProps {
    params: Promise<{
        case_id: string;
        file_id: string;
    }>;
}

export default function DynamicPage({ params }: PageProps) {
    const { case_id, file_id } = use(params);

    // This dynamically renders the normal homepage but tells it to pretend it grabbed those variables from the query string
    const simulatedSearchParams = new URLSearchParams();
    simulatedSearchParams.set('file_id', file_id);
    simulatedSearchParams.set('case_id', case_id);

    return (
        <Suspense fallback={
            <main className="min-h-[100dvh] bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 flex items-center justify-center">
                <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
            </main>
        }>
            <HomeContent simulatedParams={simulatedSearchParams} />
        </Suspense>
    );
}
