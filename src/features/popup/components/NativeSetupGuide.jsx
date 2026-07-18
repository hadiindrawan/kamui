import React, { useState, useEffect } from 'react';
import { Download, ExternalLink, CheckCircle, AlertCircle, Loader } from 'lucide-react';

/**
 * Native setup guide — shown when the native companion app is not installed.
 * Guides the user through downloading and installing the OS-specific helper.
 *
 * @param {Object} props
 * @param {boolean} props.isAvailable - Whether the native app is detected
 * @param {() => void} props.onCheck - Re-check native app availability
 * @param {string} [props.os] - Detected OS ('darwin' or 'win32')
 * @param {() => void} props.onDismiss - Dismiss the setup guide
 */
export default function NativeSetupGuide({ isAvailable, onCheck, os, onDismiss }) {
    const [step, setStep] = useState('detecting'); // 'detecting' | 'checking' | 'download' | 'install' | 'permissions' | 'complete'
    const [checking, setChecking] = useState(false);

    useEffect(() => {
        if (isAvailable) {
            setStep('complete');
        } else {
            setStep('download');
        }
    }, [isAvailable]);

    async function handleCheckAgain() {
        setChecking(true);
        setStep('checking');
        await onCheck();
        setChecking(false);
    }

    const isMac = os === 'darwin';
    const downloadUrl = isMac
        ? 'https://github.com/hadiindrawan/kamui-native/releases/latest/download/kamui-native-macos.pkg'
        : 'https://github.com/hadiindrawan/kamui-native/releases/latest/download/kamui-native-windows.msi';
    const installerName = isMac ? 'kamui-native-macos.pkg' : 'kamui-native-windows.msi';

    return (
        <div className="native-setup-guide">
            <div className="setup-header">
                <Download size={18} />
                <span>Native Recording Setup</span>
            </div>

            <p className="setup-description">
                Track your cursor anywhere on the desktop — not just inside the browser — so
                auto-zoom works for full-screen recordings too. A small helper app streams
                cursor position and clicks to the extension; the browser still does all the
                screen capture.
            </p>

            <div className="setup-steps">
                {/* Step 1: Download */}
                <div className={`setup-step ${step === 'download' ? 'active' : step === 'complete' ? 'done' : ''}`}>
                    <div className="step-number">
                        {step === 'complete' ? <CheckCircle size={16} /> : '1'}
                    </div>
                    <div className="step-content">
                        <strong>Download Helper App</strong>
                        <p>Click below to download the installer for {isMac ? 'macOS' : 'Windows'}.</p>
                        <a
                            href={downloadUrl}
                            className="btn-download"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <Download size={14} />
                            Download {installerName}
                        </a>
                    </div>
                </div>

                {/* Step 2: Install */}
                <div className={`setup-step ${step === 'download' ? '' : ''}`}>
                    <div className="step-number">2</div>
                    <div className="step-content">
                        <strong>Run the Installer</strong>
                        <p>
                            {isMac
                                ? 'Open the downloaded .pkg file and follow the instructions. The helper will be installed to /Applications.'
                                : 'Open the downloaded .msi file and follow the setup wizard.'}
                        </p>
                    </div>
                </div>

                {/* Step 3: Grant permissions (macOS only) */}
                {isMac && (
                    <div className={`setup-step ${step === 'download' ? '' : ''}`}>
                        <div className="step-number">3</div>
                        <div className="step-content">
                            <strong>Grant Permissions (macOS)</strong>
                            <p>
                                Open <strong>System Settings → Privacy & Security → Accessibility</strong> and
                                enable Kamui Native — this is what lets it see clicks outside the browser.
                                (Screen Recording permission is requested separately by Chrome when you start
                                a recording; the helper app never touches pixels.)
                            </p>
                        </div>
                    </div>
                )}

                {/* Step 4: Verify */}
                <div className={`setup-step ${step === 'checking' ? 'active' : ''}`}>
                    <div className={`step-number ${step === 'complete' ? 'done' : ''}`}>
                        {step === 'complete' ? <CheckCircle size={16} /> : isMac ? '4' : '3'}
                    </div>
                    <div className="step-content">
                        <strong>Verify Connection</strong>
                        <p>After installing, click below to verify the connection.</p>
                        <button
                            className="btn-verify"
                            onClick={handleCheckAgain}
                            disabled={checking}
                        >
                            {checking ? (
                                <><Loader size={14} className="spin" /> Checking...</>
                            ) : (
                                'Check Connection'
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {isAvailable && (
                <div className="setup-success">
                    <CheckCircle size={16} />
                    Native app is connected and ready!
                </div>
            )}

            <div className="setup-footer">
                <button className="btn-skip" onClick={onDismiss}>
                    Skip — use Browser recording mode
                </button>
                <a
                    href="https://github.com/hadiindrawan/kamui-native#troubleshooting"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-help"
                >
                    <ExternalLink size={12} />
                    Troubleshooting
                </a>
            </div>
        </div>
    );
}
