'use client';

import { useState } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline'; // Removed unused DocumentTextIcon

interface FileUploadProps {
    onFileSelect: (file: File) => void;
    isLoading: boolean;
}

export default function FileUpload({ onFileSelect, isLoading }: FileUploadProps) {
    const [dragActive, setDragActive] = useState(false);

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
            onFileSelect(e.dataTransfer.files[0]);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            onFileSelect(e.target.files[0]);
        }
    };

    return (
        <div className="w-full max-w-xl mx-auto mt-12">
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
        </div>
    );
}
