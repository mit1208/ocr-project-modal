'use client';

import { useState } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline'; // Removed unused DocumentTextIcon

interface FileUploadProps {
    onFileSelect: (file: File, isPublic: boolean) => void;
    isLoading: boolean;
}

export default function FileUpload({ onFileSelect, isLoading }: FileUploadProps) {
    const [dragActive, setDragActive] = useState(false);
    const [isPublic, setIsPublic] = useState(false);

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            onFileSelect(e.dataTransfer.files[0], isPublic);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            onFileSelect(e.target.files[0], isPublic);
        }
    };

    return (
        <div className="w-full max-w-xl mx-auto mt-12 space-y-4">
            <div
                className={`relative flex flex-col items-center justify-center w-full min-h-[300px] p-8 border-2 border-dashed rounded-2xl transition-all duration-200 ease-in-out bg-white
          ${dragActive ? 'border-blue-500 bg-blue-50/50 scale-[1.02]' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'}
          ${isLoading ? 'opacity-50 pointer-events-none' : ''}
        `}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
            >
                <input
                    type="file"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={handleChange}
                    accept="application/pdf"
                    disabled={isLoading}
                />

                <div className="flex flex-col items-center space-y-4 text-center">
                    <div className="p-4 rounded-full bg-blue-100 text-blue-600">
                        <ArrowUpTrayIcon className="w-8 h-8" />
                    </div>
                    <div>
                        <p className="text-lg font-semibold text-slate-700">
                            Click to upload or drag and drop
                        </p>
                        <p className="text-sm text-slate-500 mt-1">
                            PDF (max 20MB)
                        </p>
                    </div>
                </div>
            </div>

            {/* Public Access Toggle */}
            {!isLoading && (
                <div className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-2xl shadow-sm">
                    <div className="flex items-center space-x-3">
                        <div className={`p-2 rounded-lg ${isPublic ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'}`}>
                            {isPublic ? (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                                </svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"></path>
                                </svg>
                            )}
                        </div>
                        <div>
                            <p className="text-sm font-bold text-slate-900">Make Publicly Accessible</p>
                            <p className="text-[10px] text-slate-400 font-medium leading-tight">Anyone can view this document without signing in.</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setIsPublic(!isPublic)}
                        type="button"
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ring-2 ring-offset-2 ring-transparent ${isPublic ? 'bg-orange-500 ring-orange-500' : 'bg-slate-200'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isPublic ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>
            )}
        </div>
    );
}
